import { useAuth } from "@clerk/react";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

const BASE_URL = import.meta.env.VITE_BACKEND_URL;

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    const detail =
      body && typeof body === "object" && "detail" in body ? String((body as { detail: unknown }).detail) : null;
    super(detail ?? `Request failed with status ${status}`);
    this.status = status;
    this.body = body;
  }
}

export function useApiClient() {
  const { getToken } = useAuth();
  const navigate = useNavigate();

  const request = useCallback(
    async <T = unknown>(path: string, init: RequestInit = {}): Promise<T> => {
      const token = await getToken();
      const headers = new Headers(init.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      if (init.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }

      const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });

      if (res.status === 401) {
        navigate("/sign-in");
        throw new ApiError(401, null);
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new ApiError(res.status, body);
      }
      if (res.status === 204) return undefined as T;
      return res.json();
    },
    [getToken, navigate]
  );

  const get = useCallback(<T = unknown>(path: string) => request<T>(path), [request]);

  const post = useCallback(
    <T = unknown>(path: string, body?: unknown) =>
      request<T>(path, {
        method: "POST",
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
    [request]
  );

  const del = useCallback(<T = unknown>(path: string) => request<T>(path, { method: "DELETE" }), [request]);

  return { request, get, post, delete: del };
}

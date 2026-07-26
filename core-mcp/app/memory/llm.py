import os

import instructor
import litellm
from instructor.core.exceptions import InstructorRetryException
from pydantic import BaseModel
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

litellm.drop_params = True

client = instructor.from_litellm(litellm.acompletion)


def _provider_config() -> tuple[str, dict]:
    model = os.environ.get("CONTINUUM_FACT_EXTRACTION_MODEL", "")
    api_key = os.environ.get("CONTINUUM_FACT_EXTRACTION_API_KEY", "")
    if not model or not api_key:
        raise RuntimeError("CONTINUUM_FACT_EXTRACTION_MODEL/API_KEY is not set")
    kwargs: dict = {"api_key": api_key}
    api_base = os.environ.get("CONTINUUM_FACT_EXTRACTION_API_BASE", "")
    if api_base:
        kwargs["api_base"] = api_base
    return model, kwargs

_TRANSIENT_EXCEPTIONS = (
    litellm.exceptions.RateLimitError,
    litellm.exceptions.APIConnectionError,
    litellm.exceptions.Timeout,
)


def is_transient_failure(exc: BaseException) -> bool:
    if not isinstance(exc, InstructorRetryException):
        return False
    if isinstance(exc.__cause__, _TRANSIENT_EXCEPTIONS):
        return True
    return bool(exc.failed_attempts) and isinstance(exc.failed_attempts[-1].exception, _TRANSIENT_EXCEPTIONS)


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception(is_transient_failure),
    reraise=True,
)
async def structured[T: BaseModel](prompt: str, response_model: type[T]) -> T:
    model, kwargs = _provider_config()
    return await client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        response_model=response_model,
        max_retries=2,
        reasoning_effort="none",
        _skip_mcp_handler=True,
        **kwargs,
    )

import type { SignIn } from "@clerk/nextjs";

type Appearance = NonNullable<React.ComponentProps<typeof SignIn>["appearance"]>;

const THEME_COLORS = {
  light: {
    colorPrimary: "#d6472f",
    colorBackground: "#f9f7ef",
    colorText: "#201c17",
    colorTextSecondary: "#6b6455",
    colorInputBackground: "transparent",
    colorInputText: "#201c17",
    colorNeutral: "#201c17",
  },
  dark: {
    colorPrimary: "#e0563c",
    colorBackground: "#f2efe6",
    colorText: "#201c17",
    colorTextSecondary: "#6b6455",
    colorInputBackground: "transparent",
    colorInputText: "#201c17",
    colorNeutral: "#201c17",
  },
} as const;

const elements: NonNullable<Appearance["elements"]> = {
  rootBox: "w-full !min-w-0",
  cardBox: "w-full !min-w-0 !shadow-none !border-none !bg-transparent",
  card: "w-full !min-w-0 !shadow-none !border-none !bg-transparent !p-0 gap-5",
  scrollBox: "!min-w-0 !shadow-none !border-none !bg-transparent",
  header: "!min-w-0",
  headerTitle: "font-heading text-lg font-semibold text-foreground",
  headerSubtitle: "font-mono text-xs text-muted-foreground",
  main: "!min-w-0 gap-4",
  form: "!min-w-0 gap-4",
  formFieldLabel: "font-mono text-[0.68rem] uppercase tracking-[0.06em] text-muted-foreground",
  formFieldInput:
    "rounded-[var(--radius)] border border-border bg-transparent pl-3 pr-9 py-2 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary/40",
  formFieldInputShowPasswordButton: "!right-3 text-muted-foreground hover:text-foreground",
  formFieldInputGroup: "!min-w-0",
  formFieldAction: "font-mono text-xs text-primary hover:text-primary/80",
  formButtonPrimary:
    "rounded-[var(--radius)] bg-primary text-primary-foreground font-mono text-sm font-semibold tracking-[0.02em] normal-case shadow-[0_8px_20px_-8px_rgba(214,71,47,0.55)] transition-all duration-150 hover:bg-primary hover:-translate-y-px hover:rotate-[-0.4deg] hover:shadow-[0_12px_24px_-8px_rgba(214,71,47,0.6)]",
  footer: "mt-1 bg-transparent",
  footerAction: "font-mono text-xs text-muted-foreground",
  footerActionLink: "font-mono text-xs font-semibold text-primary hover:text-primary/80",
  socialButtonsBlockButton:
    "rounded-[var(--radius)] border border-border bg-transparent text-foreground hover:bg-accent",
  socialButtonsBlockButtonText: "font-mono text-sm",
  dividerLine: "bg-border",
  dividerText: "font-mono text-[0.62rem] uppercase tracking-[0.08em] text-muted-foreground",
  identityPreview: "rounded-[var(--radius)] border border-border bg-transparent",
  identityPreviewText: "font-mono text-sm text-foreground",
  identityPreviewEditButton: "text-primary hover:text-primary/80",
  otpCodeFieldInput: "border-border text-foreground",
  alert: "rounded-[var(--radius)] border border-destructive/30 bg-destructive/10",
  alertText: "font-mono text-xs text-destructive",
};

export function getClerkAppearance(resolvedTheme: "light" | "dark"): Appearance {
  return {
    variables: {
      ...THEME_COLORS[resolvedTheme],
      borderRadius: "0.3rem",
      fontFamily: "var(--font-sans)",
    },
    elements,
  };
}

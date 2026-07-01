import { GitHubIcon, LinkedInIcon } from "@/components/provider-icons";

// Submission requirement: credit the developer (name, GitHub, LinkedIn).
// TODO: confirm the display name and replace the LinkedIn URL before submission.
const DEVELOPER = {
  name: "Aditya",
  github: "https://github.com/ImAdityaa12",
  linkedin: "https://www.linkedin.com/in/aditya-raj-gupta-089393215",
};

export function SiteFooter() {
  return (
    <footer className="border-t px-6 py-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-3 text-sm text-muted-foreground sm:flex-row">
        <p>
          Built by{" "}
          <span className="font-medium text-foreground">{DEVELOPER.name}</span>
        </p>
        <div className="flex items-center gap-1">
          <a
            href={DEVELOPER.github}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="GitHub profile"
            className="inline-flex size-8 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground"
          >
            <GitHubIcon className="size-4" />
          </a>
          <a
            href={DEVELOPER.linkedin}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="LinkedIn profile"
            className="inline-flex size-8 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground"
          >
            <LinkedInIcon className="size-4" />
          </a>
        </div>
      </div>
    </footer>
  );
}

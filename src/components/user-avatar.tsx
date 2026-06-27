import Image from "next/image";

import { cn } from "@/lib/utils";

function initialsFrom(name?: string | null) {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function UserAvatar({
  name,
  image,
  className,
}: {
  name?: string | null;
  image?: string | null;
  className?: string;
}) {
  if (image) {
    return (
      <Image
        src={image}
        alt={name ?? "User avatar"}
        width={48}
        height={48}
        className={cn("size-12 rounded-full object-cover", className)}
      />
    );
  }

  return (
    <span
      className={cn(
        "inline-flex size-12 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground",
        className
      )}
    >
      {initialsFrom(name)}
    </span>
  );
}

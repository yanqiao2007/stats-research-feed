"use client";

import { useState } from "react";
import { AlertCircle, CloudCheck, Loader2, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/AuthProvider";
import { AccountDialog } from "./AccountDialog";

/**
 * Header control for the optional account.
 *
 * Renders nothing at all in two cases: before hydration (whether there is a
 * session is unknowable until localStorage is readable) and when the
 * deployment has no Supabase project. In the second case the feature genuinely
 * does not exist, and a button that only explains its own absence is worse
 * than no button.
 */
export function AccountButton() {
  const { status, email, sync } = useAuth();
  const [open, setOpen] = useState(false);

  if (status === "unknown" || status === "unconfigured") return null;

  const signedIn = status === "signedIn";
  const label = signedIn ? (email ?? "Account") : "Sign in";

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="shrink-0 gap-1.5 text-muted-foreground"
        aria-label={signedIn ? `Account: ${email ?? "signed in"}` : "Sign in to sync your feed"}
      >
        {!signedIn ? (
          <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
        ) : sync.status === "syncing" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : sync.status === "error" ? (
          <AlertCircle className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
        ) : (
          <CloudCheck className="h-3.5 w-3.5 text-secondary" aria-hidden="true" />
        )}
        <span className="max-w-[12ch] truncate sm:max-w-[20ch]">{label}</span>
      </Button>

      <AccountDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

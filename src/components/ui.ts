/** Class strings shared by the profile screens, matching the conversation screen's controls. */
export const primaryButton =
  "min-h-12 rounded-control border-2 border-ink bg-ink px-5 text-body font-bold text-ground shadow-lift transition-[transform] duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60";
export const secondaryButton =
  "min-h-12 rounded-control border-2 border-edge bg-raised px-5 text-body font-bold shadow-lift transition-[border-color] duration-150 hover:border-ink disabled:cursor-not-allowed disabled:opacity-60";
export const linkButton = "min-h-12 self-start text-body font-bold underline underline-offset-4";
export const fieldLabel = "text-label font-bold";
export const textField = "min-h-12 w-full rounded-control border-2 border-muted bg-raised px-4 text-body text-ink placeholder:text-muted";
export const textArea = "min-h-28 w-full rounded-control border-2 border-muted bg-raised px-4 py-3 text-body text-ink placeholder:text-muted";
export const hint = "text-label text-muted";
/** The lifted card each non-conversation screen sits on. Edge to edge on phones, so narrow screens keep their width. */
export const screenCard =
  "mx-auto w-full rounded-[1.375rem] border-2 border-edge bg-surface p-5 shadow-tray max-sm:-mx-4 max-sm:w-auto max-sm:rounded-none max-sm:border-x-0 max-sm:px-4 sm:p-8";

/** A low-key action that shouldn't compete with the replies, such as New conversation. */
export const quietButton =
  "min-h-12 rounded-control border-2 border-edge bg-raised px-4 text-label font-bold transition-[border-color] duration-150 hover:border-ink disabled:cursor-not-allowed disabled:opacity-60";

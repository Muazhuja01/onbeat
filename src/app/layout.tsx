import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Next } from "next/font/google";
import "./globals.css";

const atkinson = Atkinson_Hyperlegible_Next({
  subsets: ["latin", "latin-ext"],
  variable: "--font-atkinson",
  display: "swap",
});

export const metadata: Metadata = {
  title: "OnBeat",
  description: "Suggested spoken replies for people who communicate by typing.",
};

export const viewport: Viewport = {
  // An open on-screen keyboard shrinks the page, so the reply tray stays above it.
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#EEF1F4" },
    { media: "(prefers-color-scheme: dark)", color: "#101826" },
  ],
};

// Applies a saved theme before first paint so the page doesn't flash.
const THEME_SCRIPT = `try{var t=localStorage.getItem("onbeat:theme");if(t&&t!=="system")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: THEME_SCRIPT may add data-theme before hydration.
    <html lang="en" className={atkinson.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased">
        <a href="#replies" className="skip-link">
          Skip to replies
        </a>
        {children}
      </body>
    </html>
  );
}

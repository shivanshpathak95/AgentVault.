import type {Metadata} from "next";
import {headers} from "next/headers";
import type {ReactNode} from "react";
import {cookieToInitialState} from "wagmi";
import {getConfig} from "@/lib/wagmi";
import {Providers} from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgentVault",
  description:
    "Give AI agents money. Not unlimited control. A policy-controlled USDC wallet for autonomous agents, on Arc.",
};

export default async function RootLayout({children}: {children: ReactNode}) {
  // Rehydrate the wallet connection from the cookie wagmi's cookieStorage wrote,
  // so the first server render already knows whether a wallet is connected.
  const initialState = cookieToInitialState(getConfig(), (await headers()).get("cookie"));

  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <Providers initialState={initialState}>{children}</Providers>
      </body>
    </html>
  );
}

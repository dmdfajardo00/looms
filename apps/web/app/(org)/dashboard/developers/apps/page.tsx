import type { Metadata } from "next";
import { AppsListClient } from "./AppsListClient";

export const metadata: Metadata = {
	title: "Developer Apps — Caps",
};

export default async function AppsPage() {
	return <AppsListClient />;
}

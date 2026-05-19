import type { Metadata } from "next";
import { AppSettingsClient } from "./AppSettingsClient";

export const metadata: Metadata = {
	title: "App Settings — Caps",
};

export default async function AppSettingsPage() {
	return <AppSettingsClient />;
}

import type { Metadata } from "next";
import { GeneralPage } from "./GeneralPage";

export const metadata: Metadata = {
	title: "Organization Settings — Looms",
};

export default function OrganizationPage() {
	return <GeneralPage />;
}

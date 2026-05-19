import type { Metadata } from "next";
import { DomainsClient } from "./DomainsClient";

export const metadata: Metadata = {
	title: "Allowed Domains — Looms",
};

export default async function DomainsPage() {
	return <DomainsClient />;
}

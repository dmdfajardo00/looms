import type { Metadata } from "next";
import { RecordVideoPage } from "./RecordVideoPage";

export const metadata: Metadata = {
	title: "Record a Loom",
};

export default function RecordVideoRoute() {
	return <RecordVideoPage />;
}

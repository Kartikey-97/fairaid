import { SurveyUpload } from "@/components/SurveyUpload";

export const metadata = {
  title: "Upload Survey | FairAid",
  description: "Upload field survey data to the FairAid platform",
};

export default function SurveyUploadPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-[var(--text-strong)]">Survey Importer</h1>
        <p className="text-sm text-[var(--text-muted)] max-w-2xl">
          Use this tool to bulk-import field reports and needs data collected offline by survey teams. 
          The system will automatically parse the locations, required skills, and emergency levels.
        </p>
      </header>

      <section className="mt-4">
        <SurveyUpload />
      </section>
    </main>
  );
}

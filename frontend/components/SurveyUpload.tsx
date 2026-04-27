"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { uploadSurveyCsv } from "@/lib/api";

export function SurveyUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setMessage(null);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setMessage({ text: "Please select a CSV file first.", type: "error" });
      return;
    }

    setIsUploading(true);
    setMessage(null);

    try {
      const data = await uploadSurveyCsv(file);

      setMessage({ text: `Success: Processed ${data.processed_count} records.`, type: "success" });
      setFile(null);
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Unknown error occurred", type: "error" });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Card className="max-w-xl">
      <h2 className="text-xl font-bold text-[var(--text-strong)] mb-4">Upload Field Survey</h2>
      <p className="text-sm text-[var(--text-muted)] mb-6">
        Upload a CSV containing offline survey data collected by field volunteers. The data will be automatically parsed into needs and added to the platform.
      </p>

      <div className="space-y-4">
        <div className="border-2 border-dashed border-[var(--border)] rounded-xl p-8 text-center transition-colors hover:bg-[var(--surface-elevated)]">
          <input
            type="file"
            accept=".csv"
            id="csv-upload"
            className="hidden"
            onChange={handleFileChange}
          />
          <label htmlFor="csv-upload" className="cursor-pointer flex flex-col items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <span className="text-sm font-semibold text-[var(--text-strong)]">
              {file ? file.name : "Click to select a CSV file"}
            </span>
          </label>
        </div>

        {message && (
          <div className={`p-3 rounded-lg text-sm font-medium ${message.type === "success" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
            {message.text}
          </div>
        )}

        <Button 
          onClick={handleUpload} 
          disabled={!file || isUploading}
          className="w-full justify-center"
        >
          {isUploading ? "Uploading..." : "Process Survey Data"}
        </Button>
      </div>
    </Card>
  );
}

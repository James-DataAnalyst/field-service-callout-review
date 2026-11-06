import { CsvError, parse } from "csv-parse/sync";
import { importFormats, maxCsvKilobytes, maxImportRows, type ImportKind, type ImportRow } from "./imports";

type ReadResult = { rows: ImportRow[]; lines: number[] } | { error: string };
type ParsedRecord = { record: string[]; info: { lines: number } };

export async function readImportCsv(file: FormDataEntryValue | null, kind: ImportKind): Promise<ReadResult> {
  if (!file || typeof file === "string" || !file.name.toLowerCase().endsWith(".csv") || file.size === 0) {
    return { error: "Choose a CSV file with at least one data row." };
  }
  if (file.size > maxCsvKilobytes * 1024) {
    return { error: `Choose a CSV of ${maxCsvKilobytes} KB or less.` };
  }

  let csv: string;
  try {
    csv = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
  } catch {
    return { error: "Save the file as CSV UTF-8, then upload it again." };
  }
  if (csv.includes("\0")) {
    return { error: "Save the file as CSV UTF-8, then upload it again." };
  }

  let records: ParsedRecord[];
  try {
    // With info enabled, the parser returns each record with its physical CSV line.
    records = parse(csv, {
      bom: true,
      info: true,
      skip_empty_lines: true,
      trim: true,
      max_record_size: 2048,
    }) as unknown as ParsedRecord[];
  } catch (error) {
    const line = error instanceof CsvError ? error.lines : undefined;
    return {
      error: line
        ? `Check CSV line ${line}. Use commas, matching column counts, and closed quotes.`
        : "Could not read the CSV. Check the columns and quotes, then try again.",
    };
  }

  const [header, ...data] = records;
  const columns = header?.record.map((value) => value.trim()) ?? [];
  const required = importFormats[kind];
  if (columns.length !== required.length || !required.every((name) => columns.includes(name))) {
    return { error: `Use these CSV headers: ${required.join(", ")}.` };
  }
  if (data.length === 0 || data.length > maxImportRows) {
    return { error: `Include between 1 and ${maxImportRows} data rows.` };
  }

  return {
    rows: data.map(({ record }) => Object.fromEntries(
      columns.map((name, index) => [name, record[index].trim()]),
    )),
    lines: data.map(({ info }) => info.lines),
  };
}

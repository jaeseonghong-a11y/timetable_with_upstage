import {
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_SIZE_LABEL,
} from "./document-limits";

export const MAX_ACADEMIC_DOCUMENT_BYTES = MAX_DOCUMENT_BYTES;

interface ClipboardFileItem {
  kind: string;
  type: string;
  getAsFile: () => File | null;
}

export function validateAcademicDocumentFile(file: File): string | null {
  if (file.size === 0 || file.size > MAX_ACADEMIC_DOCUMENT_BYTES) {
    return `파일은 1바이트 이상 ${MAX_DOCUMENT_SIZE_LABEL} 이하만 분석할 수 있습니다.`;
  }
  if (!isSupportedAcademicDocument(file)) {
    return "PDF, PNG, JPG 파일만 선택해 주세요.";
  }
  return null;
}

export function getClipboardImageFile(
  items: ArrayLike<ClipboardFileItem> | null | undefined,
): File | null {
  return getClipboardImageFiles(items)[0] ?? null;
}

/** Returns every image present in one clipboard event, preserving its original item order. */
export function getClipboardImageFiles(
  items: ArrayLike<ClipboardFileItem> | null | undefined,
): File[] {
  if (!items) {
    return [];
  }
  const files: File[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item?.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) {
        files.push(file);
      }
    }
  }
  return files;
}

function isSupportedAcademicDocument(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    file.type === "application/pdf" ||
    file.type === "image/png" ||
    file.type === "image/jpeg" ||
    name.endsWith(".pdf") ||
    name.endsWith(".png") ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg")
  );
}

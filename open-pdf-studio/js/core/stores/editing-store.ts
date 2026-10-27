import { createMutable } from 'solid-js/store';
import type { Annotation } from '../../types/annotation.js';

export interface EditingState {
  isEditingText: boolean;
  editingAnnotation: Annotation | null;
  textEditElement: HTMLElement | null;
  isEditingPdfText: boolean;
  pdfTextEditState: any;
  // Open PDF-tekstbewerking zoals het canvas haar moet tekenen (#698):
  // { page, recordId?, afdekking? } of null. Zie rendering.js.
  pdfTekstEditorCanvas: any;
}

export const editingState = createMutable<EditingState>({
  isEditingText: false,
  editingAnnotation: null,
  textEditElement: null,
  isEditingPdfText: false,
  pdfTextEditState: null,
  pdfTekstEditorCanvas: null,
});

export function resetTextEditing(): void {
  editingState.isEditingText = false;
  editingState.editingAnnotation = null;
  editingState.textEditElement = null;
}

export function resetPdfTextEditing(): void {
  editingState.isEditingPdfText = false;
  editingState.pdfTextEditState = null;
  editingState.pdfTekstEditorCanvas = null;
}

export function resetAllEditing(): void {
  resetTextEditing();
  resetPdfTextEditing();
}

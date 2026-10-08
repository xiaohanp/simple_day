import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Props for a modal backdrop: close only when the press both starts and ends on
// the backdrop itself, so drag-selecting text that ends outside the panel doesn't close it.
export function backdropProps(onClose: () => void) {
  type E = { target: EventTarget; currentTarget: HTMLElement }
  return {
    onPointerDown: (e: E) => { e.currentTarget.dataset.downOnSelf = String(e.target === e.currentTarget) },
    onClick: (e: E) => { if (e.currentTarget.dataset.downOnSelf === 'true' && e.target === e.currentTarget) onClose() },
  }
}

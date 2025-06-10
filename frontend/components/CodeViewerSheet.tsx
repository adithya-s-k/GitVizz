"use client";

import { useEffect } from "react";
import { Code } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { CodeViewer } from "@/components/CodeViewer";

interface CodeViewerSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CodeViewerSheet({
  isOpen,
  onClose,
}: CodeViewerSheetProps) {
  // Handle escape key to close the sheet
  useEffect(() => {
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => {
      window.removeEventListener("keydown", handleEsc);
    };
  }, [isOpen, onClose]);

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent side="right" className="w-[90vw] sm:max-w-[90vw] p-0">
        <SheetHeader className="px-6 py-2 border-b">
          <SheetTitle className="flex items-center">
            <Code className="mr-2 h-5 w-5" />
            Code Explorer
          </SheetTitle>
        </SheetHeader>
        <div className="p-2">
          <CodeViewer />
        </div>
      </SheetContent>
    </Sheet>
  );
}

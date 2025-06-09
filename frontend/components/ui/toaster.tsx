"use client";

import { Toaster, toast, ToastOptions } from "react-hot-toast";
import { ReactNode } from "react";

export function ToasterProvider({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Toaster
      position="top-center"
      gutter={20}
      containerStyle={{
        top: 32,
        right: 32,
      }}
      />
    </>
  );
}

// Toast helpers
export const showToast = {
  success: (message: string, options?: ToastOptions) =>
    toast.success(message, options),
  error: (message: string, options?: ToastOptions) =>
    toast.error(message, options),
  info: (message: string, options?: ToastOptions) =>
    toast(message, { icon: "ℹ️", ...options }),
  loading: (message: string, options?: ToastOptions) =>
    toast.loading(message, options),
  dismiss: (toastId?: string) => toast.dismiss(toastId),
};

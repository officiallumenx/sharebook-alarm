"use client";

import { MyVoicesPanel } from "@/components/voices/MyVoicesPanel";

export function MyVoicesView() {
  return (
    <div className="py-2 pb-8 sm:py-4 sm:pb-16">
      <MyVoicesPanel variant="page" />
    </div>
  );
}

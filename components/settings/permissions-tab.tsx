"use client";

// Settings > Permissions (admin-only). Content pending — the backend has
// no permission-management API yet.

import { Card } from "@/components/ui/card";

export function PermissionsTab() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-muted-foreground">
        Role-based permissions will appear here once the backend exposes them.
      </p>
      <Card className="text-[13px] text-muted-foreground">
        Nothing to show yet.
      </Card>
    </div>
  );
}

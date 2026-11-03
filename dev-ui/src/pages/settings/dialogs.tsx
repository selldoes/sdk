import { ConfirmDialog, DeleteFilesDialog } from "@/components/settings-dialogs"
import type { WsProject } from "@/lib/ws-api"
import type { BusySet, ConfirmAction } from "./shared"

interface SettingsDialogsProps {
  deleteFilesFor: WsProject | null
  onCloseDeleteFiles: () => void
  onDeleteFilesDone: () => void
  confirmAction: ConfirmAction | null
  confirmBusy: BusySet
  onConfirm: () => void
  onConfirmOpenChange: (open: boolean) => void
}

export function SettingsDialogs({
  deleteFilesFor,
  onCloseDeleteFiles,
  onDeleteFilesDone,
  confirmAction,
  confirmBusy,
  onConfirm,
  onConfirmOpenChange,
}: SettingsDialogsProps) {
  return (
    <>
      <DeleteFilesDialog project={deleteFilesFor} onClose={onCloseDeleteFiles} onDone={onDeleteFilesDone} />
      <ConfirmDialog
        open={confirmAction !== null}
        busy={confirmBusy.anyBusy}
        title={confirmAction?.title ?? ""}
        description={confirmAction?.description ?? ""}
        confirmLabel={confirmAction?.confirmLabel ?? "Confirm"}
        danger={confirmAction?.danger}
        onOpenChange={onConfirmOpenChange}
        onConfirm={onConfirm}
      />
    </>
  )
}

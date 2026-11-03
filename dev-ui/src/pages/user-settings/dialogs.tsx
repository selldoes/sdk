import { ConfirmDialog, DeleteFilesDialog, DeleteRemoteDialog } from "@/components/settings-dialogs"
import type { WsPackage, WsProject } from "@/lib/ws-api"
import type { BusySet, ConfirmAction } from "./shared"

interface SettingsDialogsProps {
  deleteFilesFor: WsProject | null
  onCloseDeleteFiles: () => void
  onDeleteFilesDone: () => void
  deleteRemoteFor: WsPackage | null
  deleteRemoteAppUrl: string
  onCloseDeleteRemote: () => void
  onDeleteRemoteDone: () => void
  confirmAction: ConfirmAction | null
  confirmBusy: BusySet
  onConfirm: () => void
  onConfirmOpenChange: (open: boolean) => void
}

export function SettingsDialogs({
  deleteFilesFor,
  onCloseDeleteFiles,
  onDeleteFilesDone,
  deleteRemoteFor,
  deleteRemoteAppUrl,
  onCloseDeleteRemote,
  onDeleteRemoteDone,
  confirmAction,
  confirmBusy,
  onConfirm,
  onConfirmOpenChange,
}: SettingsDialogsProps) {
  return (
    <>
      <DeleteFilesDialog project={deleteFilesFor} onClose={onCloseDeleteFiles} onDone={onDeleteFilesDone} />
      <DeleteRemoteDialog
        pkg={deleteRemoteFor}
        appUrl={deleteRemoteAppUrl}
        onClose={onCloseDeleteRemote}
        onDone={onDeleteRemoteDone}
      />
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

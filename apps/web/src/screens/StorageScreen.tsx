import { ScreenHeader } from '../components/desk/ScreenHeader';
import { AccessKeys } from '../components/AccessKeys';
import { StorageSettings } from '../components/StorageSettings';
import { TrashPanel } from '../components/TrashPanel';

interface Props {
  /** Bumped by the app when a conversation went to the trash. */
  trashVersion: number;
  onRestored: () => void;
}

/** Trash, storage cleanup and backup, side by side (design: "Lixeira e armazenamento"). */
export function StorageScreen({ trashVersion, onRestored }: Props) {
  return (
    <main aria-label="Armazenamento" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ScreenHeader eyebrow="~/.owl" title="Lixeira e armazenamento" />
      <div className="grid flex-1 grid-cols-1 content-start items-start overflow-auto xl:grid-cols-3">
        <TrashPanel version={trashVersion} onRestored={onRestored} />
        <StorageSettings />
        <AccessKeys />
      </div>
    </main>
  );
}

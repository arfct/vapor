import { Menu, MenuTrigger, MenuContent, MenuItem } from "~/components/ui/menu";
import Icon from "~/components/Icon";

/**
 * The homepage tour's Create button: it stands where Share does on a
 * document, since the tour itself has nothing to share.
 */
export default function CreateMenu({ onNewDocument, onUpload }: { onNewDocument: () => void; onUpload: () => void }) {
  return (
    <Menu>
      <MenuTrigger>
        <button className="header-button" aria-label="Create" title="Create">
          <Icon name="add_2" />
        </button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem className="gap-2" onClick={onNewDocument}>
          <Icon name="note_add" />
          <span>New document</span>
        </MenuItem>
        <MenuItem className="gap-2" onClick={onUpload}>
          <Icon name="upload_file" />
          <span>Upload .md file</span>
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

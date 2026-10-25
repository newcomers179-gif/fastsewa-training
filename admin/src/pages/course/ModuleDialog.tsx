import { useState } from "react";
import { api } from "../../api";
import { useAction } from "../../hooks";
import type { ModuleNode } from "../../types";
import { Button, ErrorNotice, Modal, TextField, fieldError } from "../../ui";

interface Props {
  courseId: string;
  /** Present when editing an existing module. */
  module?: ModuleNode;
  onClose: () => void;
  onSaved: () => void;
}

export function ModuleDialog({ courseId, module, onClose, onSaved }: Props) {
  const [title, setTitle] = useState(module?.title ?? "");
  const [titleHi, setTitleHi] = useState(module?.titleHi ?? "");
  const [description, setDescription] = useState(module?.description ?? "");
  const [descriptionHi, setDescriptionHi] = useState(module?.descriptionHi ?? "");
  const [problem, setProblem] = useState<string | undefined>();

  const save = useAction(() => {
    const body = {
      title: title.trim(),
      titleHi: titleHi.trim() || null,
      description: description.trim() || null,
      descriptionHi: descriptionHi.trim() || null,
    };
    return module ? api.put(`/admin/modules/${module.id}`, body) : api.post(`/admin/courses/${courseId}/modules`, body);
  });
  const err = save.error;

  const submit = async () => {
    if (title.trim().length < 2) {
      setProblem("Give the module a title (at least 2 letters)");
      return;
    }
    setProblem(undefined);
    if ((await save.run()).ok) onSaved();
  };

  return (
    <Modal
      title={module ? "Edit module" : "Add module"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" busy={save.busy} onClick={() => void submit()}>
            {module ? "Save module" : "Add module"}
          </Button>
        </>
      }
    >
      <form
        className="form-grid"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {err && Object.keys(err.fields).length === 0 ? (
          <div className="wide">
            <ErrorNotice error={err} />
          </div>
        ) : null}
        <TextField className="wide" label="Title" required autoFocus maxLength={160} value={title} onChange={setTitle} error={problem ?? fieldError(err, "title")} hint="A module is one unit of the course, like “Harness and anchor points”. It can have lessons and one quiz." />
        <TextField className="wide" label="Title in Hindi" lang="hi" maxLength={160} value={titleHi} onChange={setTitleHi} error={fieldError(err, "titleHi")} hint="Optional. Hindi-language learners see this instead of the English title." />
        <TextField className="wide" label="Short description" multiline rows={3} maxLength={2000} value={description} onChange={setDescription} error={fieldError(err, "description")} />
        <TextField className="wide" label="Short description in Hindi" lang="hi" multiline rows={3} maxLength={2000} value={descriptionHi} onChange={setDescriptionHi} error={fieldError(err, "descriptionHi")} />
        <button type="submit" className="sr-only" tabIndex={-1}>
          Save
        </button>
      </form>
    </Modal>
  );
}

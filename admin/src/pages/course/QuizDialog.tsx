/** Edit the quiz at the end of a module: title, pass mark and 1–100 multiple-choice questions (2–6 options each). */
import { useState } from "react";
import { api, ApiError } from "../../api";
import { useAction, useApi } from "../../hooks";
import type { ModuleNode, QuizFull, QuizQuestion } from "../../types";
import { Button, CheckboxField, ErrorNotice, IconButton, Loading, Modal, Notice, TextField, describeError } from "../../ui";

interface QDraft {
  key: number;
  question: string;
  questionHi: string;
  options: string[];
  optionsHi: string[];
  withHindi: boolean;
  correct: number;
  explanation: string;
  explanationHi: string;
}

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;
const MAX_QUESTIONS = 100;

let keyCounter = 0;
const nextKey = () => ++keyCounter;

const blankQuestion = (): QDraft => ({
  key: nextKey(),
  question: "",
  questionHi: "",
  options: ["", "", "", ""],
  optionsHi: ["", "", "", ""],
  withHindi: false,
  correct: 0,
  explanation: "",
  explanationHi: "",
});

const fromApi = (q: QuizQuestion): QDraft => ({
  key: nextKey(),
  question: q.question,
  questionHi: q.questionHi ?? "",
  options: [...q.options],
  optionsHi: q.optionsHi ? [...q.optionsHi] : q.options.map(() => ""),
  withHindi: q.optionsHi !== null && q.optionsHi !== undefined,
  correct: q.correctIndex,
  explanation: q.explanation ?? "",
  explanationHi: q.explanationHi ?? "",
});

/** "questions.2.question: Too short" → "Question 3: Too short". */
function describeQuizError(error: ApiError): string {
  const first = Object.entries(error.fields)[0];
  if (error.code !== "VALIDATION_ERROR" || !first) return describeError(error);
  const match = /^questions\.(\d+)\./.exec(first[0]);
  return match ? `Question ${Number(match[1]) + 1}: ${first[1][0]}` : first[1][0];
}

function QuizForm({ module, quiz, onClose, onSaved }: { module: ModuleNode; quiz: QuizFull | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(quiz?.title ?? `${module.title} quiz`);
  const [passing, setPassing] = useState(String(quiz?.passingScore ?? 70));
  const [questions, setQuestions] = useState<QDraft[]>(() => (quiz && quiz.questions.length > 0 ? quiz.questions.map(fromApi) : [blankQuestion()]));
  const [problems, setProblems] = useState<Record<string, string>>({});

  const patch = (key: number, change: Partial<QDraft>) => setQuestions((list) => list.map((q) => (q.key === key ? { ...q, ...change } : q)));
  const move = (index: number, delta: -1 | 1) =>
    setQuestions((list) => {
      const target = index + delta;
      if (target < 0 || target >= list.length) return list;
      const copy = [...list];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });

  const setOption = (q: QDraft, index: number, hindi: boolean, value: string) => {
    const list = [...(hindi ? q.optionsHi : q.options)];
    list[index] = value;
    patch(q.key, hindi ? { optionsHi: list } : { options: list });
  };
  const addOption = (q: QDraft) => patch(q.key, { options: [...q.options, ""], optionsHi: [...q.optionsHi, ""] });
  const removeOption = (q: QDraft, index: number) =>
    patch(q.key, {
      options: q.options.filter((_, i) => i !== index),
      optionsHi: q.optionsHi.filter((_, i) => i !== index),
      correct: index === q.correct ? 0 : index < q.correct ? q.correct - 1 : q.correct,
    });

  const save = useAction(() =>
    api.put(`/admin/modules/${module.id}/quiz`, {
      title: title.trim(),
      passingScore: Number(passing),
      questions: questions.map((q) => ({
        question: q.question.trim(),
        questionHi: q.questionHi.trim() || null,
        options: q.options.map((o) => o.trim()),
        optionsHi: q.withHindi ? q.optionsHi.map((o) => o.trim()) : null,
        correctIndex: q.correct,
        explanation: q.explanation.trim() || null,
        explanationHi: q.explanationHi.trim() || null,
      })),
    })
  );

  const validate = (): Record<string, string> => {
    const found: Record<string, string> = {};
    if (title.trim().length < 2) found.title = "Give the quiz a title (at least 2 letters)";
    const pass = Number(passing);
    if (!Number.isInteger(pass) || pass < 1 || pass > 100) found.passing = "Enter a whole number from 1 to 100";
    if (questions.length === 0) found.questions = "Add at least one question";
    questions.forEach((q) => {
      if (q.question.trim().length < 3) found[`${q.key}:question`] = "Write the question (at least 3 letters)";
      q.options.forEach((o, i) => {
        if (o.trim() === "") found[`${q.key}:option:${i}`] = "Fill in this answer or remove it";
      });
      if (q.withHindi) {
        q.optionsHi.forEach((o, i) => {
          if (o.trim() === "") found[`${q.key}:hindi:${i}`] = "Fill in the Hindi answer, or untick the Hindi box";
        });
      }
    });
    return found;
  };

  const submit = async () => {
    const found = validate();
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    if ((await save.run()).ok) onSaved();
  };

  const count = Object.keys(problems).length;

  return (
    <Modal
      wide
      title={quiz ? "Edit quiz" : "Add quiz"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" busy={save.busy} onClick={() => void submit()}>
            Save quiz
          </Button>
        </>
      }
    >
      <p className="muted">
        Module: <strong>{module.title}</strong>. Learners must reach the pass mark to finish the module. Saving replaces the earlier questions; learners’ past attempts are kept.
      </p>
      {save.error ? (
        <div className="notice notice-error" role="alert">
          <div>
            <p>{describeQuizError(save.error)}</p>
          </div>
        </div>
      ) : null}
      {count > 0 ? <Notice tone="warn">Fix the {count === 1 ? "problem" : `${count} problems`} marked below, then save again.</Notice> : null}

      <div className="form-grid">
        <TextField label="Quiz title" required maxLength={160} value={title} onChange={setTitle} error={problems.title} />
        <TextField label="Pass mark (%)" required type="number" inputMode="numeric" value={passing} onChange={setPassing} error={problems.passing} hint="The score a learner needs, from 1 to 100." />
      </div>

      {questions.map((q, index) => (
        <fieldset key={q.key} className="question">
          <legend className="sr-only">Question {index + 1}</legend>
          <div className="question-head">
            <h3>Question {index + 1}</h3>
            <div className="row-actions">
              <IconButton icon="up" label={`Move question ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)} />
              <IconButton icon="down" label={`Move question ${index + 1} down`} disabled={index === questions.length - 1} onClick={() => move(index, 1)} />
              <IconButton icon="trash" label={`Delete question ${index + 1}`} disabled={questions.length === 1} onClick={() => setQuestions((list) => list.filter((x) => x.key !== q.key))} />
            </div>
          </div>
          <TextField label="Question" required multiline rows={2} maxLength={1000} value={q.question} onChange={(v) => patch(q.key, { question: v })} error={problems[`${q.key}:question`]} />
          <TextField label="Question in Hindi" lang="hi" multiline rows={2} maxLength={1000} value={q.questionHi} onChange={(v) => patch(q.key, { questionHi: v })} hint="Optional" />

          <div className="stack">
            <span className="small muted" id={`q${q.key}-options`}>
              Answers — choose the correct one with the round button
            </span>
            {q.options.map((option, i) => (
              <div key={i} className="stack">
                <div className="option-row" role="group" aria-labelledby={`q${q.key}-options`}>
                  <input type="radio" name={`correct-${q.key}`} checked={q.correct === i} onChange={() => patch(q.key, { correct: i })} aria-label={`Answer ${i + 1} is the correct one`} />
                  <TextField label={`Answer ${i + 1}`} value={option} maxLength={500} onChange={(v) => setOption(q, i, false, v)} error={problems[`${q.key}:option:${i}`]} />
                  <IconButton icon="x" label={`Remove answer ${i + 1}`} disabled={q.options.length <= MIN_OPTIONS} onClick={() => removeOption(q, i)} />
                </div>
                {q.withHindi ? (
                  <div className="option-row">
                    <span />
                    <TextField label={`Answer ${i + 1} in Hindi`} lang="hi" value={q.optionsHi[i] ?? ""} maxLength={500} onChange={(v) => setOption(q, i, true, v)} error={problems[`${q.key}:hindi:${i}`]} />
                    <span />
                  </div>
                ) : null}
              </div>
            ))}
            <div className="cluster">
              <Button small icon="plus" disabled={q.options.length >= MAX_OPTIONS} onClick={() => addOption(q)}>
                Add answer
              </Button>
              <CheckboxField label="Also give the answers in Hindi" checked={q.withHindi} onChange={(v) => patch(q.key, { withHindi: v })} />
            </div>
          </div>

          <TextField label="Explanation" multiline rows={2} maxLength={2000} value={q.explanation} onChange={(v) => patch(q.key, { explanation: v })} hint="Optional. Shown after the learner answers — say why the right answer is right." />
          <TextField label="Explanation in Hindi" lang="hi" multiline rows={2} maxLength={2000} value={q.explanationHi} onChange={(v) => patch(q.key, { explanationHi: v })} />
        </fieldset>
      ))}

      <div>
        <Button icon="plus" disabled={questions.length >= MAX_QUESTIONS} onClick={() => setQuestions((list) => [...list, blankQuestion()])}>
          Add question
        </Button>
      </div>
    </Modal>
  );
}

export function QuizDialog({ module, onClose, onSaved }: { module: ModuleNode; onClose: () => void; onSaved: () => void }) {
  const existing = useApi<QuizFull>(module.quiz ? `/admin/modules/${module.id}/quiz` : null);
  if (module.quiz && !existing.data) {
    return (
      <Modal title="Edit quiz" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
        {existing.error ? <ErrorNotice error={existing.error} onRetry={existing.reload} /> : <Loading />}
      </Modal>
    );
  }
  return <QuizForm module={module} quiz={existing.data ?? null} onClose={onClose} onSaved={onSaved} />;
}

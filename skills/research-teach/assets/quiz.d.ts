// Hand-written TypeScript declarations for the quiz widget. quiz.js is the source of truth.
// test/quiz-declaration.test.mjs checks that the runtime export names and kinds agree.

export type QuizOption = string;

export interface QuizItem {
  readonly q: string;
  readonly options: readonly QuizOption[];
  readonly correct: number;
  readonly why?: readonly (string | undefined)[] | null | undefined;
}

type ShuffledOptions = {
  options: QuizOption[];
  why: (string | undefined)[];
  correct: number;
  order: number[];
};

export function shuffleOptions<Item extends Pick<QuizItem, 'options' | 'correct' | 'why'>>(
  item: Item, rand?: () => number,
): Omit<Item, keyof ShuffledOptions> & ShuffledOptions;

export interface QuizGrade {
  total: number;
  wrong: number[];
}

export function grade(items: readonly Pick<QuizItem, 'correct'>[], answers: readonly (number | undefined)[]): QuizGrade;

export function lessonIdFrom(pathname?: string | null, fallback?: string | null): string | null;
export function answerLengthSpread(item: Pick<QuizItem, 'options'>): number;

export interface LessonRow {
  readonly id: string;
  readonly line?: unknown;
}

export interface LessonIndex<Row extends LessonRow = LessonRow> {
  readonly lessons?: readonly Row[] | null | undefined;
  readonly lines?: unknown;
}

export function neighbours<Row extends LessonRow>(
  lessons: readonly Row[], id: string | null,
): { prev: Row | null; next: Row | null };

export function pathPosition<Row extends LessonRow>(index: LessonIndex<Row>, id: string | null): `line ${number} of ${number}` | null;

export function mergeQuizzes<Part extends object>(parts: readonly (Part & { readonly predict?: boolean | undefined })[]): Part[];
export function answerMark(chosen: number, correct: number): 'Correct' | 'Not this one';

export interface AttemptAnswers {
  readonly lesson: string | null;
  readonly answers: readonly number[];
}

export interface Attempt extends AttemptAnswers {
  readonly at: string;
  readonly total: number;
  readonly wrong: readonly number[];
}

export function resultsFile(key: string, attempts: readonly Attempt[]): string;
export function renderNav(): Promise<void>;

// The widget appends nodes it creates itself. Describe only the members it uses on supplied nodes,
// so these declarations also work for Node callers without the DOM library.
interface AppendTarget {
  append(...nodes: object[]): void;
}

export interface RenderQuizPart {
  readonly container: AppendTarget;
  readonly items: readonly QuizItem[];
}

type SubmitReply = string | null | void;

export interface RenderQuizOptions {
  rand?: (() => number) | undefined;
  submit?: ((payload: AttemptAnswers, grade: QuizGrade) => SubmitReply | PromiseLike<SubmitReply>) | undefined;
}

export function renderQuiz(parts: readonly RenderQuizPart[], options?: RenderQuizOptions): void;

export const LAB_ENDED_EARLY: 'The reply ended before the lab finished.';
export function labStatus(text: string, done: boolean): `lab: ${string}` | typeof LAB_ENDED_EARLY;

export interface LabSection extends AppendTarget {
  readonly dataset?: {
    readonly lab?: string | undefined;
    readonly labLive?: string | undefined;
    readonly labVerify?: string | undefined;
  } | undefined;
}

export function renderLab(section?: LabSection | null): void;

export interface ReplayElement {
  readonly dataset: {
    readonly cast: string;
    readonly castText?: string | undefined;
  };
}

export interface ReplayRoot<Element extends ReplayElement> {
  querySelectorAll(selector: '[data-cast]'): Iterable<Element>;
}

export interface ReplayPlayer<Element extends ReplayElement> {
  create(source: string | { data: string }, element: Element): void;
}

export function mountReplays<Element extends ReplayElement>(root: ReplayRoot<Element>, player?: ReplayPlayer<Element> | null): void;

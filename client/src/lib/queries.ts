/**
 * Every server read the screens make, in one place: the query key, the request and whether the answer
 * is kept for offline use. Screens call `useQuery(courseOptions(id))`; after a change they refresh what
 * it affected through `refreshAfter*` so a finished lesson shows up in the course, the task list and
 * the stats without anyone pulling to refresh.
 */
import { infiniteQueryOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import type { AppConfig, Category, CertificateItem, CourseListItem, CourseOutline, EnrolledCourse, LessonDetail, ModuleDetail, QuizData, Stats } from "@/types";
import { api } from "./api";

export const PAGE_SIZE = 20;

const persist = { persist: true } as const;

export const keys = {
  config: ["config"] as const,
  courses: (category: Category | null, q: string) => ["courses", { category, q }] as const,
  course: (id: string) => ["course", id] as const,
  module: (id: string) => ["module", id] as const,
  lesson: (id: string) => ["lesson", id] as const,
  quiz: (moduleId: string) => ["quiz", moduleId] as const,
  enrolled: ["enrolled"] as const,
  stats: ["stats"] as const,
  certificates: ["certificates"] as const,
};

export const configOptions = () =>
  queryOptions({
    queryKey: keys.config,
    queryFn: ({ signal }) => api.get<AppConfig>("/config", { auth: false, signal }),
    staleTime: 10 * 60_000,
    meta: persist,
  });

export interface CoursePage {
  items: CourseListItem[];
  offset: number;
  total: number;
}

export const coursesOptions = (params: { category: Category | null; q: string }) =>
  infiniteQueryOptions({
    queryKey: keys.courses(params.category, params.q),
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }): Promise<CoursePage> => {
      const { data, total } = await api.getWithMeta<CourseListItem[]>("/courses", {
        signal,
        query: { category: params.category, q: params.q, limit: PAGE_SIZE, offset: pageParam },
      });
      return { items: data, offset: pageParam, total: total ?? pageParam + data.length };
    },
    getNextPageParam: (last) => {
      const next = last.offset + last.items.length;
      return last.items.length > 0 && next < last.total ? next : undefined;
    },
    // The plain catalogue (and one category) is worth keeping for offline use; every typed search is not.
    meta: params.q === "" ? persist : undefined,
  });

export const courseOptions = (id: string) =>
  queryOptions({
    queryKey: keys.course(id),
    queryFn: ({ signal }) => api.get<CourseOutline>(`/courses/${id}`, { signal }),
    meta: persist,
  });

export const moduleOptions = (id: string) =>
  queryOptions({
    queryKey: keys.module(id),
    queryFn: ({ signal }) => api.get<ModuleDetail>(`/courses/module/${id}`, { signal }),
    meta: persist,
  });

export const lessonOptions = (id: string) =>
  queryOptions({
    queryKey: keys.lesson(id),
    queryFn: ({ signal }) => api.get<LessonDetail>(`/courses/lesson/${id}`, { signal }),
    meta: persist,
  });

/** Never remembered and never reused: a quiz must reflect the attempts and lock state of right now. */
export const quizOptions = (moduleId: string) =>
  queryOptions({
    queryKey: keys.quiz(moduleId),
    queryFn: ({ signal }) => api.get<QuizData>(`/quiz/module/${moduleId}`, { signal }),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

export const enrolledOptions = () =>
  queryOptions({
    queryKey: keys.enrolled,
    queryFn: ({ signal }) => api.get<EnrolledCourse[]>("/progress/enrolled-courses", { signal }),
    meta: persist,
  });

export const statsOptions = () =>
  queryOptions({
    queryKey: keys.stats,
    queryFn: ({ signal }) => api.get<Stats>("/progress/stats", { signal }),
    meta: persist,
  });

export const certificatesOptions = () =>
  queryOptions({
    queryKey: keys.certificates,
    queryFn: ({ signal }) => api.get<CertificateItem[]>("/certificates", { signal }),
    meta: persist,
  });

// ─── refreshing what a change affected ────────────────────────────────────────
export interface Touched {
  courseId?: string;
  moduleId?: string;
  lessonId?: string;
  certificate?: boolean;
}

/** Progress moved (a lesson finished, a quiz passed, a course joined): refresh every screen that shows it. */
export function refreshAfterProgress(client: QueryClient, touched: Touched): Promise<unknown> {
  const jobs: Promise<unknown>[] = [
    client.invalidateQueries({ queryKey: ["courses"] }),
    client.invalidateQueries({ queryKey: keys.enrolled }),
    client.invalidateQueries({ queryKey: keys.stats }),
  ];
  // Without a course id (a quiz does not know it) refresh every opened course outline.
  jobs.push(client.invalidateQueries({ queryKey: touched.courseId ? keys.course(touched.courseId) : ["course"] }));
  if (touched.moduleId) {
    jobs.push(client.invalidateQueries({ queryKey: keys.module(touched.moduleId) }));
    jobs.push(client.invalidateQueries({ queryKey: keys.quiz(touched.moduleId) }));
  }
  if (touched.lessonId) jobs.push(client.invalidateQueries({ queryKey: keys.lesson(touched.lessonId) }));
  if (touched.certificate) jobs.push(client.invalidateQueries({ queryKey: keys.certificates }));
  return Promise.all(jobs);
}

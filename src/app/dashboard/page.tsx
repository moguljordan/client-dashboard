"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { db, storage } from "@/lib/firebase";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult,
} from "@hello-pangea/dnd";

// ----- Types -----
type TaskStatus = "new" | "in-progress" | "review" | "done";

interface FileItem {
  name: string;
  url: string;
  uploadedAt?: string;
}

interface CommentItem {
  author: string;
  text: string;
  at?: string;
}

interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  date?: string;
  files: FileItem[];
  comments: CommentItem[];
}

interface Project {
  id: "default";
  title: string;
  tasks: Task[];
  createdAt?: any;
  updatedAt?: any;
}

const PIPELINE: TaskStatus[] = ["new", "in-progress", "review", "done"];

function classNames(...list: (string | false | null | undefined)[]) {
  return list.filter(Boolean).join(" ");
}

// debounce helper (for description auto-save)
function useDebounce<T>(value: T, delay = 400) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ----- Component -----
export default function DashboardPage() {
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const selectedTask = useMemo(
    () => project?.tasks.find((t) => t.id === selectedTaskId) ?? null,
    [project, selectedTaskId]
  );
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const debouncedDesc = useDebounce(editDesc, 400);

  // Load project from Firestore
  useEffect(() => {
    if (!user) return;

    const pRef = doc(db, "users", user.uid, "projects", "default");

    getDoc(pRef).then(async (snap) => {
      if (!snap.exists()) {
        const starter: Project = {
          id: "default",
          title: "Design Board",
          tasks: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        await setDoc(pRef, starter);
      }
    });

    const unsubSnap = onSnapshot(
      pRef,
      (docSnap) => {
        const data = docSnap.data() as Project | undefined;
        if (data) {
          data.tasks = (data.tasks || []).map((t: any) => ({
            ...t,
            files: Array.isArray(t.files) ? t.files : [],
            comments: Array.isArray(t.comments) ? t.comments : [],
          }));
          setProject(data);
        }
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setErrMsg(err.message || "Failed to read project.");
        setLoading(false);
      }
    );

    return () => unsubSnap();
  }, [user]);

  // keep modal inputs in sync
  useEffect(() => {
    if (selectedTask) {
      setEditTitle(selectedTask.title ?? "");
      setEditDesc(selectedTask.description ?? "");
    } else {
      setEditTitle("");
      setEditDesc("");
    }
  }, [selectedTask]);

  const projectRef = useMemo(() => {
    if (!user) return null;
    return doc(db, "users", user.uid, "projects", "default");
  }, [user]);

  async function persistTasks(nextTasks: Task[]) {
    if (!projectRef) return;
    try {
      await updateDoc(projectRef, {
        tasks: nextTasks,
        updatedAt: serverTimestamp(),
      });
    } catch (e: any) {
      console.error(e);
      setErrMsg(e.message ?? "Failed to save changes.");
    }
  }

  function setTasksLocal(next: Task[]) {
    setProject((prev) => (prev ? { ...prev, tasks: next } : prev));
  }

  async function addTask(title: string) {
    if (!project) return;
    const newTask: Task = {
      id: String(Date.now()),
      title,
      description: "",
      status: "new",
      date: new Date().toISOString(),
      files: [],
      comments: [],
    };
    const next = [...project.tasks, newTask];
    setTasksLocal(next);
    await persistTasks(next);
  }

  async function updateTask(taskId: string, updates: Partial<Task>) {
    if (!project) return;
    const next = project.tasks.map((t) =>
      t.id === taskId ? { ...t, ...updates } : t
    );
    setTasksLocal(next);
    await persistTasks(next);
  }

  async function moveTask(taskId: string, nextStatus: TaskStatus) {
    if (!project) return;
    const without = project.tasks.filter((t) => t.id !== taskId);
    const moved = project.tasks.find((t) => t.id === taskId);
    if (!moved) return;
    const updatedMoved = { ...moved, status: nextStatus };
    const next = [...without, updatedMoved];
    setTasksLocal(next);
    await persistTasks(next);
  }

  const onDragEnd = async (result: DropResult) => {
    if (!project) return;
    const { destination, draggableId } = result;
    if (!destination) return;
    await moveTask(draggableId, destination.droppableId as TaskStatus);
  };

  async function addComment(text: string) {
    if (!project || !selectedTask || !text.trim()) return;
    const safeComments = Array.isArray(selectedTask.comments) ? selectedTask.comments : [];
    const nextComments = [
      ...safeComments,
      { author: user?.email ?? "You", text, at: new Date().toISOString() },
    ];
    await updateTask(selectedTask.id, { comments: nextComments });
  }

  async function handleFileUpload(file: File) {
    if (!project || !selectedTask || !user) return;
    try {
      const path = `users/${user.uid}/tasks/${selectedTask.id}/${file.name}`;
      const ref = storageRef(storage, path);
      await uploadBytes(ref, file);
      const url = await getDownloadURL(ref);

      const safeFiles = Array.isArray(selectedTask.files) ? selectedTask.files : [];
      const nextFiles = [
        ...safeFiles,
        { name: file.name, url, uploadedAt: new Date().toISOString() },
      ];
      await updateTask(selectedTask.id, { files: nextFiles });
    } catch (e: any) {
      console.error(e);
      setErrMsg(e.message ?? "File upload failed.");
    }
  }

  if (loading) {
    return <div className="text-center text-gray-400">Loading board...</div>;
  }

  if (!user) {
    return <div className="text-center text-gray-400">Please log in.</div>;
  }

  return (
    <div className="p-6 text-white">
      <h1 className="text-2xl font-bold mb-4">{project?.title ?? "Board"}</h1>
      {errMsg && <div className="mb-2 text-red-400">{errMsg}</div>}

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {PIPELINE.map((status) => (
            <Droppable droppableId={status} key={status}>
              {(provided) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className="rounded-lg bg-gray-900 p-4 min-h-[400px]"
                >
                  <h3 className="capitalize mb-2 font-semibold">{status.replace("-", " ")}</h3>
                  {status === "new" && (
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const input = e.currentTarget.elements.namedItem("taskTitle") as HTMLInputElement;
                        const val = input.value.trim();
                        if (val) {
                          await addTask(val);
                          input.value = "";
                        }
                      }}
                      className="flex gap-2 mb-3"
                    >
                      <input
                        name="taskTitle"
                        placeholder="Add task..."
                        className="flex-1 bg-gray-800 rounded px-2 py-1"
                      />
                      <button type="submit" className="bg-blue-600 px-2 py-1 rounded">+</button>
                    </form>
                  )}
                  {(project?.tasks || [])
                    .filter((t) => t.status === status)
                    .map((task, index) => (
                      <Draggable draggableId={task.id} index={index} key={task.id}>
                        {(prov) => (
                          <div
                            ref={prov.innerRef}
                            {...prov.draggableProps}
                            {...prov.dragHandleProps}
                            onClick={() => setSelectedTaskId(task.id)}
                            className="p-3 mb-2 bg-gray-800 rounded cursor-pointer"
                          >
                            <div className="font-semibold">{task.title}</div>
                            {task.description && (
                              <div className="text-xs text-gray-400">{task.description}</div>
                            )}
                          </div>
                        )}
                      </Draggable>
                    ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          ))}
        </div>
      </DragDropContext>

      {selectedTask && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center">
          <div ref={modalRef} className="bg-gray-900 p-6 rounded-lg w-[500px]">
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="w-full mb-2 p-2 bg-gray-800 rounded"
            />
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              className="w-full p-2 bg-gray-800 rounded min-h-[100px]"
            />
            <button onClick={() => setSelectedTaskId(null)} className="mt-4 bg-red-600 px-3 py-1 rounded">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

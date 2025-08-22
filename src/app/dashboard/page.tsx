"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";
import {
  doc,
  setDoc,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
  Timestamp,
} from "firebase/firestore";
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult,
} from "@hello-pangea/dnd";

type TaskStatus = "new" | "in-progress" | "review" | "done";

interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  dueDate?: string;
  position: number;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
  priority?: "low" | "medium" | "high";
  tags?: string[];
  assignedTo?: string;
}

interface Comment {
  id: string;
  text: string;
  createdAt: Timestamp | null;
  author: string;
}

interface LinkItem {
  id: string;
  title: string;
  url: string;
  createdAt: Timestamp | null;
}

const PIPELINE: TaskStatus[] = ["new", "in-progress", "review", "done"];

function getDueDateClass(dueDate?: string) {
  if (!dueDate) return "text-gray-500";
  const today = new Date();
  const due = new Date(dueDate);

  const isOverdue = due < new Date(today.toDateString());
  const isToday = due.toDateString() === today.toDateString();

  if (isOverdue) return "text-red-600 font-medium";
  if (isToday) return "text-orange-500 font-medium";
  return "text-gray-500";
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // subcollections for modal
  const [comments, setComments] = useState<Comment[]>([]);
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [newComment, setNewComment] = useState("");
  const [newLinkTitle, setNewLinkTitle] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState("");

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId]
  );
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");

  // Firestore refs
  const projectRef = useMemo(() => {
    if (!user) return null;
    return doc(db, "users", user.uid, "projects", "default");
  }, [user]);

  const tasksCol = useMemo(() => {
    if (!projectRef) return null;
    return collection(projectRef, "tasks");
  }, [projectRef]);

  // Load project + tasks
  useEffect(() => {
    if (!user || !projectRef || !tasksCol) return;

    setDoc(projectRef, { title: "Design Board" }, { merge: true }).catch(
      () => {}
    );

    const q = query(tasksCol, orderBy("position", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const taskList: Task[] = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data() as Omit<Task, "id">;
          taskList.push({ id: docSnap.id, ...data });
        });
        setTasks(taskList);
        setLoading(false);
      },
      (err) => {
        const message =
          err && typeof err === "object" && "message" in err
            ? String((err as { message?: string }).message)
            : "Failed to load tasks";
        setErrMsg(message);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [user, projectRef, tasksCol]);

  // Load comments + links when a task is selected
  useEffect(() => {
    if (!selectedTaskId || !tasksCol) return;

    const taskRef = doc(tasksCol, selectedTaskId);
    const commentsCol = collection(taskRef, "comments");
    const linksCol = collection(taskRef, "links");

    const unsubComments = onSnapshot(
      query(commentsCol, orderBy("createdAt", "asc")),
      (snap) => {
        const list: Comment[] = [];
        snap.forEach((d) => {
          const data = d.data() as Omit<Comment, "id">;
          list.push({ id: d.id, ...data });
        });
        setComments(list);
      }
    );

    const unsubLinks = onSnapshot(
      query(linksCol, orderBy("createdAt", "desc")),
      (snap) => {
        const list: LinkItem[] = [];
        snap.forEach((d) => {
          const data = d.data() as Omit<LinkItem, "id">;
          list.push({ id: d.id, ...data });
        });
        setLinks(list);
      }
    );

    return () => {
      unsubComments();
      unsubLinks();
    };
  }, [selectedTaskId, tasksCol]);

  // sync modal inputs when task changes
  useEffect(() => {
    if (selectedTask) {
      setEditTitle(selectedTask.title ?? "");
      setEditDesc(selectedTask.description ?? "");
    } else {
      setEditTitle("");
      setEditDesc("");
    }
  }, [selectedTask]);

  // CRUD helpers
  const addTask = useCallback(
    async (title: string) => {
      if (!tasksCol || !user) return;
      await addDoc(tasksCol, {
        title,
        description: "",
        status: "new" as TaskStatus,
        dueDate: "",
        position: tasks.filter((t) => t.status === "new").length,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        priority: "medium",
        tags: [],
        assignedTo: user.uid,
      });
    },
    [tasksCol, user, tasks]
  );

  const updateTask = useCallback(
    async (taskId: string, updates: Partial<Task>) => {
      if (!tasksCol) return;
      const taskRef = doc(tasksCol, taskId);
      await updateDoc(taskRef, { ...updates, updatedAt: serverTimestamp() });
    },
    [tasksCol]
  );

  const deleteTaskById = useCallback(
    async (taskId: string) => {
      if (!tasksCol) return;
      const confirmed = confirm("Delete this task?");
      if (!confirmed) return;
      await deleteDoc(doc(tasksCol, taskId));
      setSelectedTaskId(null);
    },
    [tasksCol]
  );

  const addComment = useCallback(async () => {
    if (!tasksCol || !selectedTaskId || !newComment.trim() || !user) return;
    const taskRef = doc(tasksCol, selectedTaskId);
    const commentsCol = collection(taskRef, "comments");
    await addDoc(commentsCol, {
      text: newComment,
      author: user.displayName || user.email || "Unknown",
      createdAt: serverTimestamp(),
    });
    setNewComment("");
  }, [tasksCol, selectedTaskId, newComment, user]);

  const addLink = useCallback(async () => {
    if (!tasksCol || !selectedTaskId || !newLinkUrl.trim()) return;
    const taskRef = doc(tasksCol, selectedTaskId);
    const linksCol = collection(taskRef, "links");
    await addDoc(linksCol, {
      title: newLinkTitle || newLinkUrl,
      url: newLinkUrl,
      createdAt: serverTimestamp(),
    });
    setNewLinkTitle("");
    setNewLinkUrl("");
  }, [tasksCol, selectedTaskId, newLinkTitle, newLinkUrl]);

  // Drag & Drop reorder
  const onDragEnd = useCallback(
    async (result: DropResult) => {
      if (!tasksCol) return;
      const { destination, source } = result;
      if (!destination) return;

      const sourceCol = source.droppableId as TaskStatus;
      const destCol = destination.droppableId as TaskStatus;

      const tasksInSource = tasks
        .filter((t) => t.status === sourceCol)
        .sort((a, b) => a.position - b.position);

      const tasksInDest = tasks
        .filter((t) => t.status === destCol)
        .sort((a, b) => a.position - b.position);

      const [moved] = tasksInSource.splice(source.index, 1);
      tasksInDest.splice(destination.index, 0, { ...moved, status: destCol });

      await Promise.all([
        ...tasksInSource.map((t, i) =>
          updateTask(t.id, { position: i, status: sourceCol })
        ),
        ...tasksInDest.map((t, i) =>
          updateTask(t.id, { position: i, status: destCol })
        ),
      ]);
    },
    [tasksCol, tasks, updateTask]
  );

  // Auto-save modal
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        if (selectedTask) {
          void updateTask(selectedTask.id, {
            title: editTitle,
            description: editDesc,
          });
        }
        setSelectedTaskId(null);
      }
    }
    if (selectedTask) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [selectedTask, editTitle, editDesc, updateTask]);

  if (loading) return <div>Loading...</div>;
  if (!user) return <div>Please log in</div>;

  return (
    <div className="p-6 bg-gray-50 min-h-screen text-gray-900">
      <h1 className="text-2xl font-bold mb-4">
        Hello, {user.displayName || user.email}
      </h1>
      {errMsg && <div className="text-red-600">{errMsg}</div>}

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {PIPELINE.map((status) => (
            <Droppable droppableId={status} key={status}>
              {(provided) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className="rounded-lg bg-white border border-gray-200 p-4 min-h-[400px]"
                >
                  <h3 className="capitalize mb-2 font-semibold">
                    {status.replace("-", " ")}
                  </h3>

                  {status === "new" && (
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const form = e.currentTarget;
                        const input = form.elements.namedItem(
                          "taskTitle"
                        ) as HTMLInputElement | null;
                        const val = (input?.value ?? "").trim();
                        if (val) {
                          await addTask(val);
                          if (input) input.value = "";
                        }
                      }}
                      className="flex gap-2 mb-3"
                    >
                      <input
                        name="taskTitle"
                        placeholder="Add task..."
                        className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                      />
                      <button
                        type="submit"
                        className="bg-orange-600 text-white px-3 py-1 rounded text-sm"
                      >
                        Add
                      </button>
                    </form>
                  )}

                  {tasks
                    .filter((t) => t.status === status)
                    .sort((a, b) => a.position - b.position)
                    .map((task, index) => (
                      <Draggable draggableId={task.id} index={index} key={task.id}>
                        {(prov) => (
                          <div
                            ref={prov.innerRef}
                            {...prov.draggableProps}
                            {...prov.dragHandleProps}
                            onClick={() => setSelectedTaskId(task.id)}
                            className="p-3 mb-2 bg-gray-50 border border-gray-200 rounded cursor-pointer hover:bg-gray-100"
                          >
                            <div className="font-medium">{task.title}</div>
                            {task.description && (
                              <div className="text-xs text-gray-500 mt-1 line-clamp-2">
                                {task.description}
                              </div>
                            )}
                            {task.dueDate && (
                              <div
                                className={`text-xs mt-1 ${getDueDateClass(
                                  task.dueDate
                                )}`}
                              >
                                Due: {new Date(task.dueDate).toLocaleDateString()}
                              </div>
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

      {/* Modal */}
      {selectedTask && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div
            ref={modalRef}
            className="bg-white rounded-lg p-6 w-[95vw] max-w-2xl shadow-lg"
          >
            <div className="flex justify-between items-center mb-4">
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="flex-1 border border-gray-300 rounded px-3 py-2 font-semibold"
                placeholder="Task title"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => deleteTaskById(selectedTask.id)}
                  className="px-3 py-2 rounded border border-red-500 text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
                <button
                  onClick={() => setSelectedTaskId(null)}
                  className="px-3 py-2 rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
                >
                  Close
                </button>
              </div>
            </div>

            <label className="block text-sm text-gray-500 mb-1">
              Description
            </label>
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              placeholder="Add a detailed description…"
              className="w-full min-h-[120px] border border-gray-300 rounded px-3 py-2 text-sm"
            />

            {/* Comments */}
            <div className="mt-6">
              <h3 className="text-md font-semibold mb-2">Comments</h3>
              <div className="space-y-2 max-h-40 overflow-y-auto border border-gray-200 p-2 rounded">
                {comments.map((c) => (
                  <div key={c.id} className="text-sm border-b pb-1">
                    <span className="font-medium">{c.author}: </span>
                    {c.text}
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-2">
                <input
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Write a comment..."
                  className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                />
                <button
                  onClick={addComment}
                  className="bg-gray-800 text-white px-3 py-1 rounded text-sm"
                >
                  Post
                </button>
              </div>
            </div>

            {/* Links */}
            <div className="mt-6">
              <h3 className="text-md font-semibold mb-2">Links</h3>
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  placeholder="Title"
                  value={newLinkTitle}
                  onChange={(e) => setNewLinkTitle(e.target.value)}
                  className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                />
                <input
                  type="url"
                  placeholder="https://example.com"
                  value={newLinkUrl}
                  onChange={(e) => setNewLinkUrl(e.target.value)}
                  className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                />
                <button
                  onClick={addLink}
                  className="bg-gray-800 text-white px-3 py-1 rounded text-sm"
                >
                  Add
                </button>
              </div>
              <ul className="mt-2 space-y-1 text-sm">
                {links.map((link) => (
                  <li key={link.id}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 underline"
                    >
                      {link.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Due Date */}
            <div className="mt-6">
              <label className="block text-sm text-gray-500 mb-1">
                Due Date
              </label>
              <input
                type="date"
                value={selectedTask.dueDate || ""}
                onChange={(e) =>
                  void updateTask(selectedTask.id, { dueDate: e.target.value })
                }
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { db, storage } from "@/lib/firebase";
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

type TaskStatus = "new" | "in-progress" | "review" | "done";

interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  dueDate?: string;
  position: number;
  createdAt?: any;
  updatedAt?: any;
  // ✅ Added fields (saved to Firestore, optional so old docs still work)
  priority?: "low" | "medium" | "high";
  tags?: string[];
  assignedTo?: string;
}

interface Comment {
  id: string;
  text: string;
  createdAt: any;
  author: string;
}

interface File {
  id: string;
  url: string;
  name: string;
  createdAt: any;
}

interface Project {
  id: string;
  title: string;
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
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // 👇 subcollections for modal
  const [comments, setComments] = useState<Comment[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [newComment, setNewComment] = useState("");

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId]
  );
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");

  // 🔥 references
  const projectRef = useMemo(() => {
    if (!user) return null;
    return doc(db, "users", user.uid, "projects", "default");
  }, [user]);

  const tasksCol = useMemo(() => {
    if (!projectRef) return null;
    return collection(projectRef, "tasks");
  }, [projectRef]);

  // ✅ Load project doc + listen for tasks
  useEffect(() => {
    if (!user || !projectRef || !tasksCol) return;

    // ensure project exists
    setDoc(projectRef, { title: "Design Board" }, { merge: true });

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
        setProject({ id: "default", title: "Design Board" });
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setErrMsg(err.message || "Failed to load tasks");
        setLoading(false);
      }
    );

    return () => unsub();
  }, [user, projectRef, tasksCol]);

  // 👇 Load comments + files when a task is selected
  useEffect(() => {
    if (!selectedTaskId || !tasksCol) return;

    const taskRef = doc(tasksCol, selectedTaskId);
    const commentsCol = collection(taskRef, "comments");
    const filesCol = collection(taskRef, "files");

    const unsubComments = onSnapshot(
      query(commentsCol, orderBy("createdAt", "asc")),
      (snap) => {
        const list: Comment[] = [];
        snap.forEach((d) =>
          list.push({ id: d.id, ...(d.data() as Omit<Comment, "id">) })
        );
        setComments(list);
      }
    );

    const unsubFiles = onSnapshot(
      query(filesCol, orderBy("createdAt", "desc")),
      (snap) => {
        const list: File[] = [];
        snap.forEach((d) =>
          list.push({ id: d.id, ...(d.data() as Omit<File, "id">) })
        );
        setFiles(list);
      }
    );

    return () => {
      unsubComments();
      unsubFiles();
    };
  }, [selectedTaskId, tasksCol]);

  // sync modal edits
  useEffect(() => {
    if (selectedTask) {
      setEditTitle(selectedTask.title ?? "");
      setEditDesc(selectedTask.description ?? "");
    } else {
      setEditTitle("");
      setEditDesc("");
    }
  }, [selectedTask]);

  // CRUD
  async function addTask(title: string) {
    if (!tasksCol || !user) return;
    await addDoc(tasksCol, {
      title,
      description: "",
      status: "new",
      dueDate: "",
      position: tasks.filter((t) => t.status === "new").length,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      // ✅ new structured defaults
      priority: "medium",
      tags: [],
      assignedTo: user.uid,
    });
  }

  async function updateTask(taskId: string, updates: Partial<Task>) {
    if (!tasksCol) return;
    const taskRef = doc(tasksCol, taskId);
    await updateDoc(taskRef, { ...updates, updatedAt: serverTimestamp() });
  }

  async function deleteTask(taskId: string) {
    if (!tasksCol) return;
    const confirmed = confirm("Delete this task?");
    if (!confirmed) return;
    await deleteDoc(doc(tasksCol, taskId));
    setSelectedTaskId(null);
  }

  // Comments
  async function addComment() {
    if (!tasksCol || !selectedTaskId || !newComment.trim() || !user) return;
    const taskRef = doc(tasksCol, selectedTaskId);
    const commentsCol = collection(taskRef, "comments");
    await addDoc(commentsCol, {
      text: newComment,
      author: user.displayName || user.email,
      createdAt: serverTimestamp(),
    });
    setNewComment("");
  }

  // Files
  async function uploadFile(file: File) {
    if (!tasksCol || !selectedTaskId || !file) return;
    const taskRef = doc(tasksCol, selectedTaskId);
    const filesCol = collection(taskRef, "files");

    const storagePath = `users/${user?.uid}/projects/default/tasks/${selectedTaskId}/${file.name}`;
    const fileRef = storageRef(storage, storagePath);
    await uploadBytes(fileRef, file);
    const url = await getDownloadURL(fileRef);

    await addDoc(filesCol, {
      url,
      name: file.name,
      createdAt: serverTimestamp(),
    });
  }

  // Drag & Drop reorder
  const onDragEnd = async (result: DropResult) => {
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

    tasksInSource.forEach((t, i) =>
      updateTask(t.id, { position: i, status: sourceCol })
    );
    tasksInDest.forEach((t, i) =>
      updateTask(t.id, { position: i, status: destCol })
    );
  };

  // Auto-save modal on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        if (selectedTask) {
          updateTask(selectedTask.id, {
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
  }, [selectedTask, editTitle, editDesc]);

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
                        const input =
                          e.currentTarget.elements.namedItem(
                            "taskTitle"
                          ) as HTMLInputElement;
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
                                Due:{" "}
                                {new Date(task.dueDate).toLocaleDateString()}
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
                  onClick={() => deleteTask(selectedTask.id)}
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

            {/* Files */}
            <div className="mt-6">
              <h3 className="text-md font-semibold mb-2">Files</h3>
              <input
                type="file"
                onChange={(e) => {
                  if (e.target.files?.[0]) uploadFile(e.target.files[0]);
                }}
              />
              <ul className="mt-2 space-y-1 text-sm">
                {files.map((f) => (
                  <li key={f.id}>
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 underline"
                    >
                      {f.name}
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
                  updateTask(selectedTask.id, { dueDate: e.target.value })
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

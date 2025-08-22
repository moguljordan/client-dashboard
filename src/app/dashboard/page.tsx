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

type ProjectStatus = "new" | "in-progress" | "review" | "done";

interface Project {
  id: string;
  title: string;
  description: string;
  status: ProjectStatus;
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

const PIPELINE: ProjectStatus[] = ["new", "in-progress", "review", "done"];

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
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // subcollections for modal
  const [comments, setComments] = useState<Comment[]>([]);
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [newComment, setNewComment] = useState("");
  const [newLinkTitle, setNewLinkTitle] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState("");

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");

  // Firestore refs
  const projectsCol = useMemo(() => {
    if (!user) return null;
    return collection(db, "users", user.uid, "projects");
  }, [user]);

  // Load projects
  useEffect(() => {
    if (!user || !projectsCol) return;

    const q = query(projectsCol, orderBy("position", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Project[] = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data() as Omit<Project, "id">;
          list.push({ id: docSnap.id, ...data });
        });
        setProjects(list);
        setLoading(false);
      },
      (err) => {
        const message =
          err && typeof err === "object" && "message" in err
            ? String((err as { message?: string }).message)
            : "Failed to load projects";
        setErrMsg(message);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [user, projectsCol]);

  // Load comments + links when a project is selected
  useEffect(() => {
    if (!selectedProjectId || !projectsCol) return;

    const projectRef = doc(projectsCol, selectedProjectId);
    const commentsCol = collection(projectRef, "comments");
    const linksCol = collection(projectRef, "links");

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
  }, [selectedProjectId, projectsCol]);

  // sync modal inputs when project changes
  useEffect(() => {
    if (selectedProject) {
      setEditTitle(selectedProject.title ?? "");
      setEditDesc(selectedProject.description ?? "");
    } else {
      setEditTitle("");
      setEditDesc("");
    }
  }, [selectedProject]);

  // CRUD helpers
  const addProject = useCallback(
    async (title: string) => {
      if (!projectsCol || !user) return;
      await addDoc(projectsCol, {
        title,
        description: "",
        status: "new" as ProjectStatus,
        dueDate: "",
        position: projects.filter((p) => p.status === "new").length,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        priority: "medium",
        tags: [],
        assignedTo: user.uid,
      });
    },
    [projectsCol, user, projects]
  );

  const updateProject = useCallback(
    async (projectId: string, updates: Partial<Project>) => {
      if (!projectsCol) return;
      const projectRef = doc(projectsCol, projectId);
      await updateDoc(projectRef, { ...updates, updatedAt: serverTimestamp() });
    },
    [projectsCol]
  );

  const deleteProjectById = useCallback(
    async (projectId: string) => {
      if (!projectsCol) return;
      const confirmed = confirm("Delete this project?");
      if (!confirmed) return;
      await deleteDoc(doc(projectsCol, projectId));
      setSelectedProjectId(null);
    },
    [projectsCol]
  );

  const addComment = useCallback(async () => {
    if (!projectsCol || !selectedProjectId || !newComment.trim() || !user) return;
    const projectRef = doc(projectsCol, selectedProjectId);
    const commentsCol = collection(projectRef, "comments");
    await addDoc(commentsCol, {
      text: newComment,
      author: user.displayName || user.email || "Unknown",
      createdAt: serverTimestamp(),
    });
    setNewComment("");
  }, [projectsCol, selectedProjectId, newComment, user]);

  const addLink = useCallback(async () => {
    if (!projectsCol || !selectedProjectId || !newLinkUrl.trim()) return;
    const projectRef = doc(projectsCol, selectedProjectId);
    const linksCol = collection(projectRef, "links");
    await addDoc(linksCol, {
      title: newLinkTitle || newLinkUrl,
      url: newLinkUrl,
      createdAt: serverTimestamp(),
    });
    setNewLinkTitle("");
    setNewLinkUrl("");
  }, [projectsCol, selectedProjectId, newLinkTitle, newLinkUrl]);

  // Drag & Drop reorder
  const onDragEnd = useCallback(
    async (result: DropResult) => {
      if (!projectsCol) return;
      const { destination, source } = result;
      if (!destination) return;

      const sourceCol = source.droppableId as ProjectStatus;
      const destCol = destination.droppableId as ProjectStatus;

      const projectsInSource = projects
        .filter((p) => p.status === sourceCol)
        .sort((a, b) => a.position - b.position);

      const projectsInDest = projects
        .filter((p) => p.status === destCol)
        .sort((a, b) => a.position - b.position);

      const [moved] = projectsInSource.splice(source.index, 1);
      projectsInDest.splice(destination.index, 0, { ...moved, status: destCol });

      await Promise.all([
        ...projectsInSource.map((p, i) =>
          updateProject(p.id, { position: i, status: sourceCol })
        ),
        ...projectsInDest.map((p, i) =>
          updateProject(p.id, { position: i, status: destCol })
        ),
      ]);
    },
    [projectsCol, projects, updateProject]
  );

  // Auto-save modal
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        if (selectedProject) {
          void updateProject(selectedProject.id, {
            title: editTitle,
            description: editDesc,
          });
        }
        setSelectedProjectId(null);
      }
    }
    if (selectedProject) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [selectedProject, editTitle, editDesc, updateProject]);

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
                          "projectTitle"
                        ) as HTMLInputElement | null;
                        const val = (input?.value ?? "").trim();
                        if (val) {
                          await addProject(val);
                          if (input) input.value = "";
                        }
                      }}
                      className="flex gap-2 mb-3"
                    >
                      <input
                        name="projectTitle"
                        placeholder="Add project..."
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

                  {projects
                    .filter((p) => p.status === status)
                    .sort((a, b) => a.position - b.position)
                    .map((project, index) => (
                      <Draggable
                        draggableId={project.id}
                        index={index}
                        key={project.id}
                      >
                        {(prov) => (
                          <div
                            ref={prov.innerRef}
                            {...prov.draggableProps}
                            {...prov.dragHandleProps}
                            onClick={() => setSelectedProjectId(project.id)}
                            className="p-3 mb-2 bg-gray-50 border border-gray-200 rounded cursor-pointer hover:bg-gray-100"
                          >
                            <div className="font-medium">{project.title}</div>
                            {project.description && (
                              <div className="text-xs text-gray-500 mt-1 line-clamp-2">
                                {project.description}
                              </div>
                            )}
                            {project.dueDate && (
                              <div
                                className={`text-xs mt-1 ${getDueDateClass(
                                  project.dueDate
                                )}`}
                              >
                                Due:{" "}
                                {new Date(project.dueDate).toLocaleDateString()}
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
      {selectedProject && (
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
                placeholder="Project title"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => deleteProjectById(selectedProject.id)}
                  className="px-3 py-2 rounded border border-red-500 text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
                <button
                  onClick={() => setSelectedProjectId(null)}
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
                value={selectedProject.dueDate || ""}
                onChange={(e) =>
                  void updateProject(selectedProject.id, { dueDate: e.target.value })
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

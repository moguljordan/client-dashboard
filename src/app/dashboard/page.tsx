"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";
import {
  doc,
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

// ✅ Notifications
import NotificationBell from "@/components/NotificationBell";

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
  authorUid?: string; // 👈 NEW (for permission check; optional for older docs)
}

interface LinkItem {
  id: string;
  title: string;
  url: string;
  createdAt: Timestamp | null;
}

const PIPELINE: ProjectStatus[] = ["new", "in-progress", "review", "done"];

const COLUMN_TITLES: Record<ProjectStatus, string> = {
  new: "To Do",
  "in-progress": "In Progress",
  review: "Review",
  done: "Done",
};

// Column colors
const COLUMN_COLORS: Record<ProjectStatus, string> = {
  new: "bg-gray-50 border-gray-200",
  "in-progress": "bg-gray-50 border-gray-200",
  review: "bg-gray-50 border-gray-200",
  done: "bg-emerald-50 border-emerald-200",
};

// 🔶 One place to control the focus look
const FOCUS_ORANGE =
  "focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500";

// Helpers
function getDueDateClass(dueDate?: string) {
  if (!dueDate) return "text-gray-500";
  const today = new Date();
  const due = new Date(dueDate);
  const isOverdue = due < new Date(today.toDateString());
  const isToday = due.toDateString() === today.toDateString();
  if (isOverdue) return "text-red-500 font-medium";
  if (isToday) return "text-amber-500 font-medium";
  return "text-gray-500";
}

const TAG_COLOR_CLASSES = [
  "bg-emerald-100 text-emerald-700 border-emerald-200",
  "bg-orange-100 text-orange-700 border-orange-200",
  "bg-violet-100 text-violet-700 border-violet-200",
  "bg-rose-100 text-rose-700 border-rose-200",
  "bg-amber-100 text-amber-700 border-amber-200",
  "bg-cyan-100 text-cyan-700 border-cyan-200",
  "bg-pink-100 text-pink-700 border-pink-200",
  "bg-indigo-100 text-indigo-700 border-indigo-200",
];

function tagClass(tag: string) {
  let sum = 0;
  for (let i = 0; i < tag.length; i++) sum = (sum + tag.charCodeAt(i)) | 0;
  const idx = Math.abs(sum) % TAG_COLOR_CLASSES.length;
  return `inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border ${TAG_COLOR_CLASSES[idx]}`;
}

export default function DashboardPage() {
  const { user } = useAuth();

  // role/admin switching
  const [role, setRole] = useState<string | null>(null);
  const [allUsers, setAllUsers] = useState<{ id: string; email: string }[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  // projects + ui
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // modal state
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // modal subcollections
  const [comments, setComments] = useState<Comment[]>([]);
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [newComment, setNewComment] = useState("");
  const [newLinkTitle, setNewLinkTitle] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState("");

  // modal fields
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [newTag, setNewTag] = useState("");

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

  // Role for current user
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, "users", user.uid), (snap) => {
      const r = (snap.data() as any)?.role || "client";
      setRole(r);
    });
    return () => unsub();
  }, [user]);

  // Admin: load all users
  useEffect(() => {
    if (!user || role !== "admin") return;
    const unsub = onSnapshot(collection(db, "users"), (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        email: (d.data() as any)?.email || d.id,
      }));
      setAllUsers(list);
      if (!selectedUserId && list.length > 0) setSelectedUserId(list[0].id);
    });
    return () => unsub();
  }, [user, role, selectedUserId]);

  // Which UID are we viewing?
  const targetUid = useMemo(() => {
    if (!user) return null;
    return role === "admin" ? selectedUserId : user.uid;
  }, [user, role, selectedUserId]);

  // Firestore ref for projects under target user
  const projectsCol = useMemo(() => {
    if (!targetUid) return null;
    return collection(db, "users", targetUid, "projects");
  }, [targetUid]);

  // Load projects
  useEffect(() => {
    if (!projectsCol) return;
    setLoading(true);
    const qy = query(projectsCol, orderBy("position", "asc"));
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const list: Project[] = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data() as Omit<Project, "id">;
          list.push({ id: docSnap.id, ...data });
        });
        setProjects(list);
        setLoading(false);
        setErrMsg(null);
      },
      (err) => {
        setErrMsg(err?.message || "Failed to load projects");
        setLoading(false);
      }
    );
    return () => unsub();
  }, [projectsCol]);

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

  // Sync modal inputs
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
      if (!projectsCol || !user || !targetUid) return;
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
        assignedTo: targetUid,
      });
    },
    [projectsCol, user, targetUid, projects]
  );

  const updateProject = useCallback(
    async (projectId: string, updates: Partial<Project>) => {
      if (!projectsCol) return;
      const projectRef = doc(projectsCol, projectId);
      await updateDoc(projectRef, {
        ...updates,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid || null, // 👈 NEW: who performed this change
      });
    },
    [projectsCol, user]
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
      authorUid: user.uid, // 👈 NEW: who wrote the comment
      createdAt: serverTimestamp(),
    });
    try {
      const ownerUid = selectedProject?.assignedTo || targetUid!;
      await addDoc(collection(db, "users", ownerUid, "notifications"), {
        type: "comment",
        title: `New comment on "${selectedProject?.title || "project"}"`,
        body: newComment,
        projectId: selectedProjectId,
        createdAt: serverTimestamp(),
        read: false,
      });
    } catch {}
    setNewComment("");
  }, [projectsCol, selectedProjectId, newComment, user, selectedProject, targetUid]);

  const addLink = useCallback(async () => {
    if (!projectsCol || !selectedProjectId || !newLinkUrl.trim()) return;
    const projectRef = doc(projectsCol, selectedProjectId);
    const linksCol = collection(projectRef, "links");
    await addDoc(linksCol, {
      title: newLinkTitle || newLinkUrl,
      url: newLinkUrl,
      createdAt: serverTimestamp(),
    });
    try {
      const ownerUid = selectedProject?.assignedTo || targetUid!;
      await addDoc(collection(db, "users", ownerUid, "notifications"), {
        type: "link",
        title: `New link: ${newLinkTitle || newLinkUrl}`,
        body: selectedProject?.title || "Project",
        projectId: selectedProjectId,
        createdAt: serverTimestamp(),
        read: false,
        link: newLinkUrl,
      });
    } catch {}
    setNewLinkTitle("");
    setNewLinkUrl("");
  }, [projectsCol, selectedProjectId, newLinkTitle, newLinkUrl, selectedProject, targetUid]);

  const deleteLinkById = useCallback(
    async (linkId: string) => {
      if (!projectsCol || !selectedProjectId) return;
      const projectRef = doc(projectsCol, selectedProjectId);
      const linksCol = collection(projectRef, "links");
      await deleteDoc(doc(linksCol, linkId));
    },
    [projectsCol, selectedProjectId]
  );

  // ✅ NEW: Delete a comment (author or admin)
  const deleteCommentById = useCallback(
    async (commentId: string) => {
      if (!projectsCol || !selectedProjectId) return;
      const ok = confirm("Delete this comment?");
      if (!ok) return;
      const projectRef = doc(projectsCol, selectedProjectId);
      const commentsCol = collection(projectRef, "comments");
      await deleteDoc(doc(commentsCol, commentId));
    },
    [projectsCol, selectedProjectId]
  );

  const addTagToProject = useCallback(async () => {
    if (!selectedProject || !newTag.trim()) return;
    const clean = newTag.trim();
    const existing = selectedProject.tags || [];
    if (existing.includes(clean)) {
      setNewTag("");
      return;
    }
    await updateProject(selectedProject.id, { tags: [...existing, clean] });
    setNewTag("");
  }, [selectedProject, newTag, updateProject]);

  const removeTagFromProject = useCallback(
    async (tag: string) => {
      if (!selectedProject) return;
      const existing = selectedProject.tags || [];
      await updateProject(selectedProject.id, {
        tags: existing.filter((t) => t !== tag),
      });
    },
    [selectedProject, updateProject]
  );

  // Drag & Drop
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

  // Modal: autosave on outside click + ESC
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
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape" && selectedProject) {
        void updateProject(selectedProject.id, {
          title: editTitle,
          description: editDesc,
        });
        setSelectedProjectId(null);
      }
    }
    if (selectedProject) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEsc);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [selectedProject, editTitle, editDesc, updateProject]);

  const handleSaveAndClose = useCallback(async () => {
    if (!selectedProject) return;
    await updateProject(selectedProject.id, {
      title: editTitle,
      description: editDesc,
    });
    setSelectedProjectId(null);
  }, [selectedProject, editTitle, editDesc, updateProject]);

  // Guards
  if (!user)
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-600">
        Please log in
      </div>
    );
  if (loading)
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-600">
        Loading...
      </div>
    );

  if (role === "admin" && !targetUid) {
    return (
      <div className="p-8 bg-gray-50 min-h-screen">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-light text-gray-900 mb-4">Dashboard</h1>
          <p className="text-gray-600">Select a client to view their board…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-sm font-light text-gray-900">Dashboard</h1>
              <p className="text-2xl mt-1">
                Welcome,{" "}
                {user.displayName?.split(" ")[0] || user.email?.split("@")[0]}
              </p>
            </div>

            {/* Right side: admin switcher + bell */}
            <div className="flex items-center gap-3">
              {role === "admin" && (
                <>
                  <label className="text-sm font-medium text-gray-800">
                    Viewing:
                  </label>
                  <select
                    value={selectedUserId ?? ""}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                    className={`bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm ${FOCUS_ORANGE}`}
                  >
                    {allUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.email}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <NotificationBell />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {errMsg && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {errMsg}
          </div>
        )}

        <DragDropContext onDragEnd={onDragEnd}>
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {PIPELINE.map((status) => (
              <Droppable droppableId={status} key={status}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`rounded-xl border-2 p-4 min-h-[500px] transition-colors ${
                      snapshot.isDraggingOver
                        ? "bg-gray-100 border-gray-300"
                        : COLUMN_COLORS[status]
                    }`}
                  >
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-medium text-gray-900 text-sm uppercase tracking-wide">
                        {COLUMN_TITLES[status]}
                      </h3>
                      <div className="bg-gray-200 text-gray-700 text-xs font-medium px-2 py-1 rounded-full">
                        {projects.filter((p) => p.status === status).length}
                      </div>
                    </div>

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
                        className="mb-4"
                      >
                        <div className="flex gap-2">
                          <input
                            name="projectTitle"
                            placeholder="Add a new task..."
                            className={`flex-1 bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-black placeholder-gray-500 transition-colors ${FOCUS_ORANGE}`}
                          />
                          <button
                            type="submit"
                            className={`bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-700 transition-colors focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:outline-none`}
                          >
                            Add
                          </button>
                        </div>
                      </form>
                    )}

                    <div className="space-y-3">
                      {projects
                        .filter((p) => p.status === status)
                        .sort((a, b) => a.position - b.position)
                        .map((project, index) => (
                          <Draggable
                            draggableId={project.id}
                            index={index}
                            key={project.id}
                          >
                            {(prov, snapShot) => (
                              <div
                                ref={prov.innerRef}
                                {...prov.draggableProps}
                                {...prov.dragHandleProps}
                                onClick={() => setSelectedProjectId(project.id)}
                                className={`group bg-white border border-gray-200 rounded-lg p-4 cursor-pointer transition-all hover:border-gray-300 hover:shadow-sm ${
                                  snapShot.isDragging ? "shadow-lg rotate-3" : ""
                                }`}
                              >
                                <div className="flex items-start justify-between mb-2">
                                  <h4 className="font-medium text-gray-900 leading-snug">
                                    {project.title}
                                  </h4>
                                  {project.status !== "done" && (
                                    <button
                                      title="Mark as done"
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        await updateProject(project.id, { status: "done" });
                                        try {
                                          const ownerUid = project.assignedTo || targetUid!;
                                          await addDoc(
                                            collection(db, "users", ownerUid, "notifications"),
                                            {
                                              type: "status",
                                              title: `Status changed to "done"`,
                                              body: project.title,
                                              projectId: project.id,
                                              createdAt: serverTimestamp(),
                                              read: false,
                                            }
                                          );
                                        } catch {}
                                      }}
                                      className="opacity-0 group-hover:opacity-100 text-emerald-600 hover:text-emerald-700 text-lg leading-none transition-all"
                                    >
                                      ✓
                                    </button>
                                  )}
                                </div>

                                {project.description && (
                                  <p className="text-xs text-gray-700 mb-3 line-clamp-2 leading-relaxed">
                                    {project.description}
                                  </p>
                                )}

                                {project.dueDate && (
                                  <div
                                    className={`text-xs mb-3 ${getDueDateClass(
                                      project.dueDate
                                    )}`}
                                  >
                                    Due {new Date(project.dueDate).toLocaleDateString()}
                                  </div>
                                )}

                                {project.tags && project.tags.length > 0 && (
                                  <div className="flex flex-wrap gap-1.5 mt-3">
                                    {project.tags.map((t) => (
                                      <span key={t} className={tagClass(t)}>
                                        {t}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </Draggable>
                        ))}
                    </div>
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            ))}
          </div>
        </DragDropContext>
      </div>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 py-6">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              © 2025 Mogul Design Agency. All rights reserved.
            </p>
            <p className="text-xs text-gray-400">Client Dashboard™</p>
          </div>
        </div>
      </footer>

      {/* Modal */}
      {selectedProject && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div
            ref={modalRef}
            className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto"
          >
            {/* Modal Header */}
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 rounded-t-xl">
              <div className="flex items-center justify-between gap-3">
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className={`flex-1 text-xl font-semibold text-gray-900 bg-transparent border border-transparent rounded-lg px-2 py-1 -mx-2 ${FOCUS_ORANGE}`}
                  placeholder="Project title"
                />
                <div className="flex items-center gap-2">
                  {selectedProject.status !== "done" && (
                    <button
                      onClick={async () => {
                        await updateProject(selectedProject.id, { status: "done" });
                        try {
                          const ownerUid = selectedProject.assignedTo || targetUid!;
                          await addDoc(collection(db, "users", ownerUid, "notifications"), {
                            type: "status",
                            title: `Status changed to "done"`,
                            body: selectedProject.title,
                            projectId: selectedProject.id,
                            createdAt: serverTimestamp(),
                            read: false,
                          });
                        } catch {}
                      }}
                      className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
                    >
                      Mark Done
                    </button>
                  )}
                  <button
                    onClick={() => deleteProjectById(selectedProject.id)}
                    className="px-4 py-2 border border-red-300 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
                  >
                    Delete
                  </button>
                  <button
                    onClick={handleSaveAndClose}
                    className="px-4 py-2 border border-gray-300 text-gray-800 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left column */}
                <div className="space-y-6">
                  {/* Description */}
                  <section className="border border-gray-200 rounded-lg p-4">
                    <h3 className="text-sm font-medium text-gray-800 mb-2">
                      Description
                    </h3>
                    <textarea
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      placeholder="Add a detailed description..."
                      className={`w-full min-h-[140px] bg-white border border-gray-300 rounded-lg px-4 py-3 text-sm text-gray-900 placeholder-gray-500 resize-y ${FOCUS_ORANGE}`}
                    />
                  </section>

                  {/* Comments */}
                  <section className="border border-gray-200 rounded-lg p-4">
                    <h3 className="text-sm font-medium text-gray-800 mb-3">
                      Comments
                    </h3>
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-3 max-h-48 overflow-y-auto">
                      {comments.length === 0 ? (
                        <p className="text-sm text-gray-500 italic">
                          No comments yet
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {comments.map((c) => {
                            const canDelete =
                              role === "admin" || (!!c.authorUid && c.authorUid === user.uid);
                            return (
                              <div
                                key={c.id}
                                className="border-b border-gray-200 pb-2 last:border-b-0"
                              >
                                <div className="flex items-start justify-between gap-2 mb-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-gray-800">
                                      {c.author}
                                    </span>
                                    <span className="text-xs text-gray-500">
                                      {c.createdAt?.toDate().toLocaleString()}
                                    </span>
                                  </div>
                                  {canDelete && (
                                    <button
                                      onClick={() => deleteCommentById(c.id)}
                                      className="text-gray-400 hover:text-red-600 text-xs px-2 py-1 rounded focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
                                      title="Delete comment"
                                    >
                                      Delete
                                    </button>
                                  )}
                                </div>
                                <p className="text-sm text-gray-700">{c.text}</p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <input
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        placeholder="Write a comment..."
                        className={`flex-1 bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-500 ${FOCUS_ORANGE}`}
                      />
                      <button
                        onClick={addComment}
                        className="px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
                      >
                        Post
                      </button>
                    </div>
                  </section>
                </div>

                {/* Right column */}
                <div className="space-y-6">
                  {/* Details */}
                  <section className="border border-gray-200 rounded-lg p-4">
                    <h3 className="text-sm font-medium text-gray-800 mb-3">
                      Details
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-gray-600">Due Date</label>
                        <input
                          type="date"
                          value={selectedProject.dueDate || ""}
                          onChange={(e) =>
                            void updateProject(selectedProject.id, {
                              dueDate: e.target.value,
                            })
                          }
                          className={`bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 ${FOCUS_ORANGE}`}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-gray-600">Status</label>
                        <select
                          value={selectedProject.status}
                          onChange={async (e) => {
                            const next = e.target.value as ProjectStatus;
                            await updateProject(selectedProject.id, { status: next });
                            try {
                              const ownerUid = selectedProject.assignedTo || targetUid!;
                              await addDoc(collection(db, "users", ownerUid, "notifications"), {
                                type: "status",
                                title: `Status changed to "${next}"`,
                                body: selectedProject.title,
                                projectId: selectedProject.id,
                                createdAt: serverTimestamp(),
                                read: false,
                              });
                            } catch {}
                          }}
                          className={`bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 ${FOCUS_ORANGE}`}
                        >
                          {PIPELINE.map((s) => (
                            <option key={s} value={s}>
                              {COLUMN_TITLES[s]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </section>

                  {/* Labels */}
                  <section className="border border-gray-200 rounded-lg p-4">
                    <h3 className="text-sm font-medium text-gray-800 mb-3">
                      Labels
                    </h3>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {(selectedProject.tags || []).map((t) => (
                        <span key={t} className={`${tagClass(t)} group`}>
                          {t}
                          <button
                            onClick={() => removeTagFromProject(t)}
                            className="ml-1 opacity-60 hover:opacity-100 transition-opacity"
                            title="Remove label"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex flex-col gap-2">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="Add a label..."
                          value={newTag}
                          onChange={(e) => setNewTag(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void addTagToProject();
                            }
                          }}
                          className={`flex-1 bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-500 ${FOCUS_ORANGE}`}
                        />
                        <button
                          onClick={addTagToProject}
                          className="px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  </section>

                  {/* Links */}
                  <section className="border border-gray-200 rounded-lg p-4">
                    <h3 className="text-sm font-medium text-gray-800 mb-3">
                      Links
                    </h3>
                    <div className="space-y-3 mb-3 max-h-40 overflow-y-auto">
                      {links.length === 0 ? (
                        <p className="text-sm text-gray-500 italic">No links yet</p>
                      ) : (
                        links.map((link) => (
                          <div key={link.id} className="flex items-center justify-between gap-2">
                            <a
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-orange-600 hover:underline truncate"
                              title={link.url}
                            >
                              {link.title}
                            </a>
                            <button
                              onClick={() => deleteLinkById(link.id)}
                              className="text-gray-400 hover:text-red-500 text-xs focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 rounded"
                            >
                              Delete
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="flex flex-col gap-2">
                      <input
                        type="text"
                        placeholder="Link URL"
                        value={newLinkUrl}
                        onChange={(e) => setNewLinkUrl(e.target.value)}
                        className={`bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-500 ${FOCUS_ORANGE}`}
                      />
                      <input
                        type="text"
                        placeholder="Title (optional)"
                        value={newLinkTitle}
                        onChange={(e) => setNewLinkTitle(e.target.value)}
                        className={`bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-500 ${FOCUS_ORANGE}`}
                      />
                      <button
                        onClick={addLink}
                        className="w-full mt-1 px-4 py-2 bg-gray-800 text-white text-sm font-medium rounded-lg hover:bg-black transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
                      >
                        Add Link
                      </button>
                    </div>
                  </section>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

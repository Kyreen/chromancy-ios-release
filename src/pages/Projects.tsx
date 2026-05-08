import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Search, 
  Filter, 
  Grid, 
  List, 
  MoreVertical, 
  FolderOpen, 
  Image as ImageIcon, 
  Video, 
  Wand2, 
  Plus,
  Trash2,
  Download,
  Share2,
  Clock,
  Briefcase
} from "lucide-react";
import { cn } from "../lib/utils";
import { UserTier, Project } from "../types";
import { auth, getProjects, deleteProject } from "../lib/firebase";
import { toast } from "sonner";

interface ProjectsProps {
  tier: UserTier;
  onNavigate: (tab: string) => void;
}

export function Projects({ tier, onNavigate }: ProjectsProps) {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<'all' | 'design' | 'photo' | 'video' | 'business'>('all');
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [showNewProjectMenu, setShowNewProjectMenu] = useState(false);

  useEffect(() => {
    const userId = auth.currentUser?.uid;
    if (!userId) {
      setIsLoading(false);
      return;
    }

    const fetchProjects = async () => {
      try {
        const items = await getProjects(userId);
        setProjects(items || []);
      } catch (error) {
        toast.error("Failed to load projects");
      } finally {
        setIsLoading(false);
      }
    };

    fetchProjects();
  }, []);

  const handleDelete = async (id: string) => {
    try {
      await deleteProject(id);
      setProjects(projects.filter(p => p.id !== id));
      toast.success("Project deleted");
    } catch (error) {
      toast.error("Failed to delete project");
    }
  };

  const filteredProjects = projects.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = activeFilter === 'all' || p.type === activeFilter;
    return matchesSearch && matchesFilter;
  });

  const getIcon = (type: string) => {
    switch (type) {
      case 'design': return Wand2;
      case 'photo': return ImageIcon;
      case 'video': return Video;
      case 'business': return Briefcase;
      default: return FolderOpen;
    }
  };

  if (isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center space-y-4">
        <div className="w-12 h-12 border-4 border-white/10 border-t-white rounded-full animate-spin" />
        <p className="text-white/40">Loading projects...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-black">
      {/* Search & Filter Bar */}
      <div className="p-4 space-y-4 border-b border-white/5">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <input 
            type="text" 
            placeholder="Search projects..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-white/30 transition-all"
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {['all', 'design', 'photo', 'video', 'business'].map((filter) => (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter as any)}
                className={cn(
                  "px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all",
                  activeFilter === filter ? "bg-white text-black" : "bg-white/5 text-white/40 border border-white/10 hover:bg-white/10"
                )}
              >
                {filter}
              </button>
            ))}
          </div>

          <div className="flex gap-1 p-1 rounded-xl bg-white/5 border border-white/10">
            <button 
              onClick={() => setViewMode('grid')}
              className={cn("p-1.5 rounded-lg transition-all", viewMode === 'grid' ? "bg-white/10 text-white" : "text-white/30")}
            >
              <Grid className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setViewMode('list')}
              className={cn("p-1.5 rounded-lg transition-all", viewMode === 'list' ? "bg-white/10 text-white" : "text-white/30")}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Projects Grid/List */}
      <div className="flex-1 overflow-y-auto p-4 pb-24">
        {filteredProjects.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-30">
            <FolderOpen className="w-16 h-16" />
            <div className="space-y-1">
              <p className="text-lg font-bold">No projects found</p>
              <p className="text-xs">Try a different search or filter.</p>
            </div>
          </div>
        ) : (
          <div className={cn(
            viewMode === 'grid' ? "grid grid-cols-2 gap-4" : "flex flex-col gap-3"
          )}>
            <AnimatePresence mode="popLayout">
              {filteredProjects.map((project, index) => {
                const Icon = getIcon(project.type);
                return (
                  <motion.div
                    key={project.id}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ delay: index * 0.05 }}
                    className={cn(
                      "group relative rounded-3xl border border-white/10 bg-white/5 overflow-hidden hover:border-white/20 transition-all active:scale-95",
                      viewMode === 'list' && "flex items-center gap-4 p-3"
                    )}
                  >
                    {/* Thumbnail */}
                    <div className={cn(
                      "relative overflow-hidden bg-gray-900",
                      viewMode === 'grid' ? "aspect-square" : "w-16 h-16 rounded-2xl flex-shrink-0"
                    )}>
                      <img 
                        src={project.enhancedUrl || project.originalUrl} 
                        alt={project.name} 
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 bg-black/20 group-hover:bg-black/0 transition-colors" />
                      <div className="absolute top-2 left-2 p-1.5 rounded-lg bg-black/50 backdrop-blur-md border border-white/10">
                        <Icon className="w-3 h-3 text-white" />
                      </div>
                    </div>

                    {/* Info */}
                    <div className={cn(
                      "p-4",
                      viewMode === 'list' && "flex-1 p-0"
                    )}>
                      <h4 className="font-bold text-sm truncate">{project.name}</h4>
                      <p className="text-[10px] text-white/40 mt-1 uppercase tracking-tighter">
                        {new Date(project.updatedAt).toLocaleDateString()}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(project.id);
                        }}
                        className="p-1.5 rounded-full bg-black/50 backdrop-blur-md border border-white/10 text-red-400 hover:bg-red-500/20"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          // In a real app, this would open a menu for rename, share, etc.
                          toast.info("Project options: Rename, Share, Export");
                        }}
                        className="p-1.5 rounded-full bg-black/50 backdrop-blur-md border border-white/10"
                      >
                        <MoreVertical className="w-3 h-3" />
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Floating Action Button */}
      <div className="fixed bottom-24 right-6 flex flex-col items-end gap-3 z-50">
        <AnimatePresence>
          {showNewProjectMenu && (
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.8 }}
              className="flex flex-col gap-2 mb-2"
            >
              {[
                { id: 'design', icon: Wand2, label: 'New Design' },
                { id: 'photo', icon: ImageIcon, label: 'New Photo' },
                { id: 'video', icon: Video, label: 'New Video' },
                { id: 'business', icon: Briefcase, label: 'New Business' }
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    onNavigate(item.id);
                    setShowNewProjectMenu(false);
                  }}
                  className="flex items-center gap-3 px-4 py-2 rounded-2xl bg-white/10 backdrop-blur-xl border border-white/10 text-white hover:bg-white/20 transition-all whitespace-nowrap"
                >
                  <item.icon className="w-4 h-4" />
                  <span className="text-xs font-bold uppercase tracking-widest">{item.label}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        <button 
          onClick={() => setShowNewProjectMenu(!showNewProjectMenu)}
          className={cn(
            "w-14 h-14 rounded-full rainbow-bg shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all",
            showNewProjectMenu && "rotate-45"
          )}
        >
          <Plus className="w-8 h-8 text-white" />
        </button>
      </div>
    </div>
  );
}

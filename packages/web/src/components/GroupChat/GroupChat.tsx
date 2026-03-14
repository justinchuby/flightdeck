import { apiFetch } from '../../hooks/useApi';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useGroupStore, groupKey } from '../../stores/groupStore';
import { MessageSquare, Send, Users, X, Plus, Crown } from 'lucide-react';
import type { ChatGroup, GroupMessage } from '../../types';
import { MentionText, AgentIdBadge, idColor } from '../../utils/markdown';
import { Markdown } from '../ui/Markdown';
import { FilterTabs } from '../FilterTabs';
import { useOptionalProjectId } from '../../contexts/ProjectContext';
import { shortAgentId } from '../../utils/agentLabel';

const EMPTY_GROUP_MSGS: GroupMessage[] = [];

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function isHuman(msg: GroupMessage): boolean {
  return msg.fromAgentId === 'human' || msg.fromRole === 'Human User';
}

function isSystem(msg: GroupMessage): boolean {
  return msg.fromRole.toLowerCase().includes('system');
}

const REACTION_EMOJIS = ['👍', '👎', '🎉', '❤️', '🤔', '👀'];

function ReactionBadges({
  msg,
  leadId,
  groupName,
}: {
  msg: GroupMessage;
  leadId: string;
  groupName: string;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const reactions = msg.reactions ?? {};
  const entries = Object.entries(reactions).filter(([, ids]) => ids.length > 0);

  const toggleReaction = async (emoji: string) => {
    const gs = useGroupStore.getState();
    const key = groupKey(leadId, groupName);
    const hasReacted = reactions[emoji]?.includes('human');

    if (hasReacted) {
      gs.removeReaction(key, msg.id, emoji, 'human');
      try {
        await apiFetch(
          `/lead/${leadId}/groups/${encodeURIComponent(groupName)}/messages/${msg.id}/reactions/${encodeURIComponent(emoji)}`,
          { method: 'DELETE' },
        );
      } catch { /* best-effort */ }
    } else {
      gs.addReaction(key, msg.id, emoji, 'human');
      try {
        await apiFetch(
          `/lead/${leadId}/groups/${encodeURIComponent(groupName)}/messages/${msg.id}/reactions`,
          { method: 'POST', body: JSON.stringify({ emoji }) },
        );
      } catch { /* best-effort */ }
    }
    setShowPicker(false);
  };

  return (
    <div className="flex items-center gap-1 mt-0.5 flex-wrap">
      {entries.map(([emoji, ids]) => (
        <button
          key={emoji}
          onClick={() => toggleReaction(emoji)}
          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${
            ids.includes('human')
              ? 'border-blue-500 bg-blue-500/20 text-blue-300'
              : 'border-th-border bg-th-bg-muted text-th-text-muted hover:border-th-text-muted'
          }`}
        >
          <span>{emoji}</span>
          <span>{ids.length}</span>
        </button>
      ))}
      <div className="relative">
        <button
          onClick={() => setShowPicker((p) => !p)}
          className="inline-flex items-center px-1 py-0.5 rounded-full text-xs text-th-text-muted hover:bg-th-bg-muted transition-colors"
          title="Add reaction"
        >
          +
        </button>
        {showPicker && (
          <div className="absolute bottom-full left-0 mb-1 flex gap-0.5 bg-th-bg-panel border border-th-border rounded-lg p-1 shadow-lg z-10">
            {REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => toggleReaction(emoji)}
                className="hover:bg-th-bg-muted rounded p-1 text-sm transition-colors"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export function GroupChat() {
  const contextProjectId = useOptionalProjectId();
  const agents = useAppStore((s) => s.agents);
  const {
    groups,
    messages,
    selectedGroup,
    setGroups,
    setMessages,
    selectGroup,
    clearSelection,
  } = useGroupStore();

  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [openTabs, setOpenTabs] = useState<Array<{ leadId: string; name: string }>>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupMembers, setNewGroupMembers] = useState<Set<string>>(new Set());
  const [newGroupLeadId, setNewGroupLeadId] = useState('');
  const [creating, setCreating] = useState(false);
  const [selectedProjectLeadId, setSelectedProjectLeadId] = useState<string | null>(contextProjectId);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const leads = agents.filter((a) => a.role.id === 'lead' && !a.parentId);

  // When inside a project context, only fetch groups for that project's leads
  const scopedLeads = useMemo(() => {
    if (!contextProjectId) return leads;
    return leads.filter((l) => l.projectId === contextProjectId || l.id === contextProjectId);
  }, [contextProjectId, leads]);

  // Refs for values used in effects that would cause loops if included as deps
  const scopedLeadsRef = useRef(scopedLeads);
  scopedLeadsRef.current = scopedLeads;
  const selectedGroupRef = useRef(selectedGroup);
  selectedGroupRef.current = selectedGroup;
  const openTabsRef = useRef(openTabs);
  openTabsRef.current = openTabs;

  // Mention autocomplete — scoped to group members when a group is selected
  const mentionCandidates = useMemo(() => {
    if (selectedGroup) {
      const group = groups.find((g) => g.leadId === selectedGroup.leadId && g.name === selectedGroup.name);
      if (group) return agents.filter((a) => group.memberIds.includes(a.id));
    }
    return agents.filter((a) => a.status === 'running' || a.status === 'idle');
  }, [selectedGroup, groups, agents]);

  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return mentionCandidates.filter(
      (a) => shortAgentId(a.id).toLowerCase().startsWith(q) || a.role.name.toLowerCase().includes(q),
    ).slice(0, 8);
  }, [mentionQuery, mentionCandidates]);

  const updateMentionState = (value: string, cursorPos: number) => {
    const before = value.slice(0, cursorPos);
    const match = before.match(/@(\w*)$/);
    if (match) { setMentionQuery(match[1]); setMentionIndex(0); } else { setMentionQuery(null); }
  };

  const insertMention = (agent: typeof agents[0]) => {
    const shortId = shortAgentId(agent.id);
    const cursorPos = textareaRef.current?.selectionStart ?? inputText.length;
    const before = inputText.slice(0, cursorPos);
    const after = inputText.slice(cursorPos);
    const atIdx = before.lastIndexOf('@');
    const newText = before.slice(0, atIdx) + `@${shortId} ` + after;
    setInputText(newText);
    setMentionQuery(null);
    textareaRef.current?.focus();
  };

  // Auto-select first lead as project filter (skip if context provides project)
  useEffect(() => {
    if (!contextProjectId && !selectedProjectLeadId && scopedLeads.length > 0) {
      setSelectedProjectLeadId(scopedLeads[0].id);
    }
  }, [contextProjectId, scopedLeads, selectedProjectLeadId]);

  // Build sets of lead agent IDs and project UUIDs for the selected project
  // so we can filter groups by leadId OR projectId (since projectId is optional on ChatGroup).
  // selectedProjectLeadId may be a lead agent ID or a project UUID depending on context.
  const { selectedLeadIds, selectedProjectIds } = useMemo(() => {
    if (!selectedProjectLeadId) return { selectedLeadIds: null, selectedProjectIds: null };
    const leadIds = new Set<string>();
    const projectIds = new Set<string>();
    for (const l of leads) {
      const matchesAsLeadId = l.id === selectedProjectLeadId;
      const matchesAsProjectId = l.projectId === selectedProjectLeadId;
      if (matchesAsLeadId || matchesAsProjectId) {
        leadIds.add(l.id);
        if (l.projectId) projectIds.add(l.projectId);
      }
    }
    // If selectedProjectLeadId looks like a project UUID (not matching any lead ID),
    // include it directly in projectIds
    if (!leads.some((l) => l.id === selectedProjectLeadId)) {
      projectIds.add(selectedProjectLeadId);
    }
    return {
      selectedLeadIds: leadIds.size > 0 ? leadIds : null,
      selectedProjectIds: projectIds.size > 0 ? projectIds : null,
    };
  }, [selectedProjectLeadId, leads]);

  // Filtered groups/tabs by selected project — match on leadId or projectId
  const filteredGroups = selectedLeadIds
    ? groups.filter((g) =>
        selectedLeadIds.has(g.leadId) ||
        (g.projectId != null && selectedProjectIds?.has(g.projectId)))
    : groups;
  const filteredTabs = selectedLeadIds
    ? openTabs.filter((t) => selectedLeadIds.has(t.leadId))
    : openTabs;

  /* ---- Fetch groups for project-scoped leads ---- */
  const leadIdsKey = scopedLeads.map((l) => l.id).join(',');
  useEffect(() => {
    const currentLeads = scopedLeadsRef.current;
    if (currentLeads.length === 0) return;
    let cancelled = false;

    async function fetchAllGroups() {
      const allGroups: ChatGroup[] = [];
      for (const lead of currentLeads) {
        try {
          const data: ChatGroup[]  = await apiFetch(`/lead/${lead.id}/groups`);
          allGroups.push(...data);
        } catch { /* skip */ }
      }
      if (!cancelled) {
        setGroups(allGroups);
        // Auto-open all groups as tabs
        if (allGroups.length > 0) {
          const tabs = allGroups.map((g) => ({ leadId: g.leadId, name: g.name }));
          setOpenTabs(tabs);
          if (!selectedGroupRef.current) selectGroup(tabs[0].leadId, tabs[0].name);
        }
      }
    }

    void fetchAllGroups();
    return () => { cancelled = true; };
  }, [leadIdsKey, setGroups, selectGroup]);

  /* ---- Auto-open new groups as tabs ---- */
  useEffect(() => {
    const currentTabs = openTabsRef.current;
    const newTabs = groups
      .filter((g) => !currentTabs.some((t) => t.leadId === g.leadId && t.name === g.name))
      .map((g) => ({ leadId: g.leadId, name: g.name }));
    if (newTabs.length > 0) {
      setOpenTabs((prev) => [...prev, ...newTabs]);
      if (!selectedGroupRef.current) {
        selectGroup(newTabs[0].leadId, newTabs[0].name);
      }
    }
  }, [groups, selectGroup]);

  /* ---- Fetch messages when selected tab changes ---- */
  useEffect(() => {
    if (!selectedGroup) return;
    let cancelled = false;

    async function fetchMessages() {
      const { leadId, name } = selectedGroup!;
      try {
        const data: GroupMessage[] = await apiFetch(
          `/lead/${leadId}/groups/${encodeURIComponent(name)}/messages`,
        );
        if (!cancelled) setMessages(groupKey(leadId, name), data);
      } catch { /* skip */ }
    }

    void fetchMessages();
    // Clear unread for this tab
    const key = groupKey(selectedGroup.leadId, selectedGroup.name);
    setUnread((prev) => ({ ...prev, [key]: 0 }));

    return () => { cancelled = true; };
  }, [selectedGroup, setMessages]);

  /* ---- Track unread for non-active tabs ---- */
  const currentKey = selectedGroup ? groupKey(selectedGroup.leadId, selectedGroup.name) : null;
  const prevMsgCounts = useRef<Record<string, number>>({});
  useEffect(() => {
    for (const [key, msgs] of Object.entries(messages)) {
      const prevCount = prevMsgCounts.current[key] ?? 0;
      if (msgs.length > prevCount && key !== currentKey) {
        setUnread((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + (msgs.length - prevCount) }));
      }
      prevMsgCounts.current[key] = msgs.length;
    }
  }, [messages, currentKey]);

  /* ---- Auto-scroll on new messages ---- */
  const currentMessages = selectedGroup
    ? messages[groupKey(selectedGroup.leadId, selectedGroup.name)] ?? EMPTY_GROUP_MSGS
    : EMPTY_GROUP_MSGS;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentMessages.length]);

  /* ---- Agent name/icon resolvers ---- */
  const agentName = useCallback(
    (id: string): string => {
      if (id === 'human') return 'You';
      const agent = agents.find((a) => a.id === id);
      return agent?.role.name ?? shortAgentId(id);
    },
    [agents],
  );

  const agentIcon = useCallback(
    (id: string): string => {
      if (id === 'human') return '👤';
      const agent = agents.find((a) => a.id === id);
      return agent?.role.icon ?? '🤖';
    },
    [agents],
  );

  /* ---- Tab management ---- */
  const switchTab = useCallback(
    (leadId: string, name: string) => {
      selectGroup(leadId, name);
      textareaRef.current?.focus();
    },
    [selectGroup],
  );

  const closeTab = useCallback(
    (leadId: string, name: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setOpenTabs((prev) => {
        const next = prev.filter((t) => !(t.leadId === leadId && t.name === name));
        // If closing the active tab, switch to neighbor
        if (selectedGroup?.leadId === leadId && selectedGroup?.name === name) {
          if (next.length > 0) {
            selectGroup(next[0].leadId, next[0].name);
          } else {
            clearSelection();
          }
        }
        return next;
      });
    },
    [selectedGroup, selectGroup, clearSelection],
  );

  /* ---- Send message ---- */
  const handleSend = useCallback(async () => {
    if (!inputText.trim() || !selectedGroup || sending) return;
    const { leadId, name } = selectedGroup;
    const text = inputText.trim();
    setInputText('');
    setSending(true);

    try {
      await apiFetch(
        `/lead/${leadId}/groups/${encodeURIComponent(name)}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({ content: text }),
        },
      );
    } catch { /* skip */ }
    finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }, [inputText, selectedGroup, sending]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.nativeEvent.isComposing) return;
      // Mention navigation
      if (mentionSuggestions.length > 0) {
        if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex((i) => Math.max(0, i - 1)); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex((i) => Math.min(i + 1, mentionSuggestions.length - 1)); return; }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          if (mentionSuggestions[mentionIndex]) insertMention(mentionSuggestions[mentionIndex]);
          return;
        }
        if (e.key === 'Escape') { setMentionQuery(null); return; }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend, mentionSuggestions, mentionIndex, insertMention],
  );

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    updateMentionState(e.target.value, e.target.selectionStart ?? e.target.value.length);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 96)}px`;
  }, []);

  /* ---- Create group ---- */
  const openCreateDialog = useCallback(() => {
    setNewGroupName('');
    setNewGroupMembers(new Set());
    setNewGroupLeadId(selectedProjectLeadId || (leads.length > 0 ? leads[0].id : ''));
    setShowCreate(true);
  }, [leads, selectedProjectLeadId]);

  const toggleMember = useCallback((id: string) => {
    setNewGroupMembers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleCreateGroup = useCallback(async () => {
    if (!newGroupName.trim() || !newGroupLeadId || creating) return;
    setCreating(true);
    try {
      const group: ChatGroup  = await apiFetch(`/lead/${newGroupLeadId}/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newGroupName.trim(),
          memberIds: Array.from(newGroupMembers),
        }),
      });
      useGroupStore.getState().addGroup(group);
      const tab = { leadId: group.leadId, name: group.name };
      setOpenTabs((prev) => [...prev, tab]);
      selectGroup(group.leadId, group.name);
      setShowCreate(false);
    } catch { /* skip */ }
    finally { setCreating(false); }
  }, [newGroupName, newGroupLeadId, newGroupMembers, creating, selectGroup]);

  // All agents belonging to a selected lead (for the create dialog)
  const availableAgents = agents.filter((a) => a.parentId === newGroupLeadId || a.id === newGroupLeadId);

  /* ---- Selected group metadata ---- */
  const selectedGroupData = selectedGroup
    ? groups.find((g) => g.name === selectedGroup.name && g.leadId === selectedGroup.leadId)
    : null;

  const _memberNames = selectedGroupData
    ? selectedGroupData.memberIds.map((id) => agentName(id)).join(', ')
    : '';

  /* ================================================================ */
  /*  Render                                                          */
  /* ================================================================ */

  return (
    <div className="flex flex-col h-full bg-th-bg text-th-text-alt">
      {/* ---- Project tabs (first level) ---- */}
      {!contextProjectId && leads.length > 0 && (
        <FilterTabs
          className="px-3 py-1.5 border-b border-th-border/50 shrink-0 bg-th-bg/50"
          items={leads.map((lead) => ({
            value: lead.id,
            label: lead.projectName || shortAgentId(lead.id),
            count: groups.filter((g) => (g.projectId ?? g.leadId) === lead.id).length || undefined,
            icon: <Crown className="w-3 h-3" />,
          }))}
          activeValue={selectedProjectLeadId}
          onSelect={(v) => setSelectedProjectLeadId(v!)}
        />
      )}

      {/* ---- Tab bar ---- */}
      <div className="flex items-center border-b border-th-border shrink-0 overflow-x-auto bg-th-bg">
        {filteredTabs.length === 0 ? (
          <div className="flex items-center gap-2 px-4 h-10 text-th-text-muted text-sm">
            <MessageSquare className="w-4 h-4" />
            No group chats{selectedProjectLeadId ? ' in this project' : ' yet'}
          </div>
        ) : (
          (() => {
            // Group tabs by project (leadId)
            const tabsByProject = new Map<string, typeof filteredTabs>();
            for (const tab of filteredTabs) {
              if (!tabsByProject.has(tab.leadId)) tabsByProject.set(tab.leadId, []);
              tabsByProject.get(tab.leadId)!.push(tab);
            }
            const showProjectHeaders = tabsByProject.size > 1;

            return Array.from(tabsByProject.entries()).map(([leadId, tabs]) => {
              const lead = leads.find((l) => l.id === leadId);
              const projectLabel = lead?.projectName || shortAgentId(leadId);
              return (
                <div key={leadId} className="flex items-center shrink-0">
                  {showProjectHeaders && (
                    <span className="flex items-center gap-1 px-2 h-10 text-[10px] font-mono font-semibold text-purple-600/70 dark:text-purple-300/70 uppercase tracking-wider whitespace-nowrap border-r border-th-border/40">
                      <Crown className="w-3 h-3 text-purple-400/60" />
                      {projectLabel}
                    </span>
                  )}
                  {tabs.map((tab) => {
                    const key = groupKey(tab.leadId, tab.name);
                    const isActive =
                      selectedGroup?.leadId === tab.leadId &&
                      selectedGroup?.name === tab.name;
                    const badge = unread[key] ?? 0;

                    return (
                      <button
                        key={key}
                        onClick={() => switchTab(tab.leadId, tab.name)}
                        className={`group flex items-center gap-1.5 px-3 h-10 text-sm border-b-2 whitespace-nowrap transition-colors shrink-0 ${
                          isActive
                            ? 'border-accent text-accent bg-accent/10'
                            : 'border-transparent text-th-text-muted hover:text-th-text hover:bg-th-bg-muted/50'
                        }`}
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span className="max-w-[120px] truncate">{tab.name}</span>
                        {badge > 0 && (
                          <span className="bg-blue-500 text-white text-[10px] font-bold rounded-full px-1.5 min-w-[18px] text-center">
                            {badge}
                          </span>
                        )}
                        <X
                          className="w-3 h-3 opacity-0 group-hover:opacity-60 hover:!opacity-100 ml-1 shrink-0"
                          onClick={(e: React.MouseEvent) => closeTab(tab.leadId, tab.name, e)}
                        />
                      </button>
                    );
                  })}
                </div>
              );
            });
          })()
        )}

        {/* New group button */}
        {leads.length > 0 && (
          <button
            onClick={openCreateDialog}
            className="flex items-center gap-1 px-2 h-10 text-xs text-th-text-muted hover:text-accent hover:bg-th-bg-muted/50 transition-colors shrink-0 border-b-2 border-transparent"
            title="Create group chat"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Re-open closed tabs dropdown */}
        {filteredGroups.length > filteredTabs.length && (
          <div className="relative ml-auto px-2">
            <select
              className="bg-th-bg-alt border border-th-border rounded text-xs text-th-text-muted px-2 py-1 cursor-pointer"
              value=""
              onChange={(e) => {
                const [leadId, ...nameParts] = e.target.value.split(':');
                const name = nameParts.join(':');
                if (!openTabs.some((t) => t.leadId === leadId && t.name === name)) {
                  setOpenTabs((prev) => [...prev, { leadId, name }]);
                }
                switchTab(leadId, name);
              }}
            >
              <option value="" disabled>+ Open group…</option>
              {(() => {
                const closed = filteredGroups.filter((g) => !openTabs.some((t) => t.leadId === g.leadId && t.name === g.name));
                const byProject = new Map<string, typeof closed>();
                for (const g of closed) {
                  if (!byProject.has(g.leadId)) byProject.set(g.leadId, []);
                  byProject.get(g.leadId)!.push(g);
                }
                return Array.from(byProject.entries()).map(([leadId, grps]) => {
                  const lead = leads.find((l) => l.id === leadId);
                  const projectLabel = lead?.projectName || shortAgentId(leadId);
                  return byProject.size > 1 ? (
                    <optgroup key={leadId} label={projectLabel}>
                      {grps.map((g) => (
                        <option key={groupKey(g.leadId, g.name)} value={`${g.leadId}:${g.name}`}>
                          {g.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : (
                    grps.map((g) => (
                      <option key={groupKey(g.leadId, g.name)} value={`${g.leadId}:${g.name}`}>
                        {g.name}
                      </option>
                    ))
                  );
                });
              })()}
            </select>
          </div>
        )}
      </div>

      {/* ---- Message area ---- */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {selectedGroup && selectedGroupData ? (
          <>
            {/* Group info header */}
            <div className="flex items-center gap-3 px-4 py-2 border-b border-th-border/50 shrink-0">
              <Users className="w-4 h-4 text-th-text-muted" />
              <div className="flex items-center gap-2 text-xs text-th-text-muted truncate flex-wrap">
                <span>{selectedGroupData.memberIds.length} members:</span>
                {selectedGroupData.memberIds.map((id) => (
                  <span key={id} className="flex items-center gap-1">
                    <span>{agentIcon(id)}</span>
                    <span>{agentName(id)}</span>
                    {id !== 'human' && <AgentIdBadge id={id} />}
                  </span>
                ))}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
              {currentMessages.length === 0 && (
                <div className="flex items-center justify-center h-full text-th-text-muted text-sm">
                  No messages yet — start the conversation!
                </div>
              )}

              {currentMessages.map((msg) => {
                if (isSystem(msg)) {
                  return (
                    <div key={msg.id} className="flex justify-center">
                      <span className="text-xs text-th-text-muted italic">
                        <MentionText text={msg.content} agents={agents} onClickAgent={(id) => useAppStore.getState().setSelectedAgent(id)} />
                      </span>
                    </div>
                  );
                }

                const human = isHuman(msg);
                return (
                  <div key={msg.id} className={`flex ${human ? 'justify-end' : 'justify-start'}`}>
                    <div className={`flex gap-2 max-w-[75%] ${human ? 'flex-row-reverse' : 'flex-row'}`}>
                      <div
                        className="w-7 h-7 rounded-full bg-th-bg-muted flex items-center justify-center text-xs shrink-0 mt-0.5"
                        style={{ borderColor: human ? undefined : idColor(msg.fromAgentId), borderWidth: human ? 0 : 2 }}
                      >
                        {agentIcon(msg.fromAgentId)}
                      </div>
                      <div>
                        <div className={`flex items-center gap-1.5 mb-0.5 ${human ? 'justify-end' : ''}`}>
                          <span className={`text-xs font-bold ${human ? 'text-blue-400' : 'text-accent'}`}>
                            {agentName(msg.fromAgentId)}
                          </span>
                          {!human && <AgentIdBadge id={msg.fromAgentId} />}
                        </div>
                        <div className={`rounded-lg px-3 py-2 text-sm ${human ? 'bg-blue-600 text-white' : 'bg-th-bg-alt text-th-text-alt'}`}>
                          <div className="whitespace-pre-wrap break-words prose-sm">
                            <Markdown text={msg.content} monospace mentionAgents={agents} onMentionClick={(id) => useAppStore.getState().setSelectedAgent(id)} />
                          </div>
                        </div>
                        <div className={`text-xs text-th-text-muted mt-0.5 ${human ? 'text-right' : ''}`}>
                          {timeAgo(msg.timestamp)}
                        </div>
                        {selectedGroup && (
                          <ReactionBadges msg={msg} leadId={selectedGroup.leadId} groupName={selectedGroup.name} />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              <div ref={messagesEndRef} />
            </div>

            {/* Compose bar */}
            <div className="border-t border-th-border p-3 shrink-0 relative">
              {/* Mention autocomplete dropdown */}
              {mentionSuggestions.length > 0 && (
                <div className="absolute bottom-full left-3 right-3 mb-1 bg-th-bg-alt border border-th-border rounded-lg shadow-xl max-h-40 overflow-y-auto z-10">
                  {mentionSuggestions.map((a, i) => (
                    <button
                      key={a.id}
                      onClick={() => insertMention(a)}
                      className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                        i === mentionIndex ? 'bg-accent/20 text-accent' : 'text-th-text-alt hover:bg-th-bg-muted'
                      }`}
                    >
                      <AgentIdBadge id={a.id} />
                      <span className="font-mono font-semibold">{a.role.name}</span>
                      <span className="text-th-text-muted text-[10px] ml-auto">{a.status}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  ref={textareaRef}
                  value={inputText}
                  onChange={handleInput}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a message…"
                  rows={1}
                  className="flex-1 bg-th-bg-alt border border-th-border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-accent"
                  style={{ maxHeight: 96 }}
                />
                <button
                  onClick={() => void handleSend()}
                  disabled={!inputText.trim() || sending}
                  className="p-2 bg-accent text-black rounded-lg hover:bg-accent-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-th-text-muted gap-3">
            <MessageSquare className="w-10 h-10" />
            <p className="text-sm">Select a group chat tab to view messages</p>
          </div>
        )}
      </div>

      {/* ---- Create group dialog ---- */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowCreate(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="relative bg-th-bg border border-th-border rounded-xl shadow-2xl w-full max-w-md p-5 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Create Group Chat</h3>
              <button onClick={() => setShowCreate(false)} className="text-th-text-muted hover:text-th-text-alt">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Group name */}
            <div>
              <label className="text-xs text-th-text-muted block mb-1">Group name</label>
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="e.g. frontend-crew"
                className="w-full bg-th-bg-alt border border-th-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
                autoFocus
              />
            </div>

            {/* Select lead/project */}
            {leads.length > 1 && (
              <div>
                <label className="text-xs text-th-text-muted block mb-1">Project</label>
                <select
                  value={newGroupLeadId}
                  onChange={(e) => { setNewGroupLeadId(e.target.value); setNewGroupMembers(new Set()); }}
                  className="w-full bg-th-bg-alt border border-th-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
                >
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.projectName ?? shortAgentId(l.id)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Select members */}
            <div>
              <label className="text-xs text-th-text-muted block mb-1">
                Members ({newGroupMembers.size} selected)
              </label>
              <div className="max-h-48 overflow-y-auto border border-th-border rounded-lg divide-y divide-th-border-muted">
                {availableAgents.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-th-text-muted text-center">No agents in this project yet</div>
                ) : (
                  availableAgents.map((a) => (
                    <label
                      key={a.id}
                      className="flex items-center gap-3 px-3 py-2 hover:bg-th-bg-alt cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={newGroupMembers.has(a.id)}
                        onChange={() => toggleMember(a.id)}
                        className="rounded border-th-border bg-th-bg-alt text-accent focus:ring-accent"
                      />
                      <span className="text-sm">{a.role.icon} {a.role.name}</span>
                      <AgentIdBadge id={a.id} className="ml-auto" />
                    </label>
                  ))
                )}
              </div>
              <p className="text-[10px] text-th-text-muted mt-1">You are always added automatically.</p>
            </div>

            {/* Create button */}
            <button
              onClick={() => void handleCreateGroup()}
              disabled={!newGroupName.trim() || creating}
              className="w-full py-2 bg-accent text-black rounded-lg text-sm font-medium hover:bg-accent-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {creating ? 'Creating…' : 'Create Group'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

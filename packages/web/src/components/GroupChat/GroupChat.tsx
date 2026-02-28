import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useGroupStore, groupKey } from '../../stores/groupStore';
import { MessageSquare, Send, Users, X, Plus, Crown } from 'lucide-react';
import type { ChatGroup, GroupMessage } from '../../types';
import { MarkdownContent, MentionText, AgentIdBadge, idColor } from '../../utils/markdown';

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

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export function GroupChat(_props: { api: any; ws: any }) {
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
  const [selectedProjectLeadId, setSelectedProjectLeadId] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const leads = agents.filter((a) => a.role.id === 'lead' && !a.parentId);

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
      (a) => a.id.slice(0, 8).toLowerCase().startsWith(q) || a.role.name.toLowerCase().includes(q),
    ).slice(0, 8);
  }, [mentionQuery, mentionCandidates]);

  const updateMentionState = (value: string, cursorPos: number) => {
    const before = value.slice(0, cursorPos);
    const match = before.match(/@(\w*)$/);
    if (match) { setMentionQuery(match[1]); setMentionIndex(0); } else { setMentionQuery(null); }
  };

  const insertMention = (agent: typeof agents[0]) => {
    const shortId = agent.id.slice(0, 8);
    const cursorPos = textareaRef.current?.selectionStart ?? inputText.length;
    const before = inputText.slice(0, cursorPos);
    const after = inputText.slice(cursorPos);
    const atIdx = before.lastIndexOf('@');
    const newText = before.slice(0, atIdx) + `@${shortId} ` + after;
    setInputText(newText);
    setMentionQuery(null);
    textareaRef.current?.focus();
  };

  // Auto-select first lead as project filter
  useEffect(() => {
    if (!selectedProjectLeadId && leads.length > 0) {
      setSelectedProjectLeadId(leads[0].id);
    }
  }, [leads, selectedProjectLeadId]);

  // Filtered groups/tabs by selected project
  const filteredGroups = selectedProjectLeadId
    ? groups.filter((g) => (g.projectId ?? g.leadId) === selectedProjectLeadId)
    : groups;
  const filteredTabs = selectedProjectLeadId
    ? openTabs.filter((t) => t.leadId === selectedProjectLeadId)
    : openTabs;

  /* ---- Fetch groups for every lead on mount ---- */
  useEffect(() => {
    if (leads.length === 0) return;
    let cancelled = false;

    async function fetchAllGroups() {
      const allGroups: ChatGroup[] = [];
      for (const lead of leads) {
        try {
          const res = await fetch(`/api/lead/${lead.id}/groups`);
          if (res.ok) {
            const data: ChatGroup[] = await res.json();
            allGroups.push(...data);
          }
        } catch { /* skip */ }
      }
      if (!cancelled) {
        setGroups(allGroups);
        // Auto-open all groups as tabs
        if (allGroups.length > 0) {
          const tabs = allGroups.map((g) => ({ leadId: g.leadId, name: g.name }));
          setOpenTabs(tabs);
          if (!selectedGroup) selectGroup(tabs[0].leadId, tabs[0].name);
        }
      }
    }

    void fetchAllGroups();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads.map((l) => l.id).join(',')]);

  /* ---- Auto-open new groups as tabs ---- */
  useEffect(() => {
    const newTabs = groups
      .filter((g) => !openTabs.some((t) => t.leadId === g.leadId && t.name === g.name))
      .map((g) => ({ leadId: g.leadId, name: g.name }));
    if (newTabs.length > 0) {
      setOpenTabs((prev) => [...prev, ...newTabs]);
      if (!selectedGroup && newTabs.length > 0) {
        selectGroup(newTabs[0].leadId, newTabs[0].name);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups.length]);

  /* ---- Fetch messages when selected tab changes ---- */
  useEffect(() => {
    if (!selectedGroup) return;
    let cancelled = false;

    async function fetchMessages() {
      const { leadId, name } = selectedGroup!;
      try {
        const res = await fetch(
          `/api/lead/${leadId}/groups/${encodeURIComponent(name)}/messages`,
        );
        if (res.ok) {
          const data: GroupMessage[] = await res.json();
          if (!cancelled) setMessages(groupKey(leadId, name), data);
        }
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
    ? messages[groupKey(selectedGroup.leadId, selectedGroup.name)] ?? []
    : [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentMessages.length]);

  /* ---- Agent name/icon resolvers ---- */
  const agentName = useCallback(
    (id: string): string => {
      if (id === 'human') return 'You';
      const agent = agents.find((a) => a.id === id);
      return agent?.role.name ?? id.slice(0, 8);
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
      await fetch(
        `/api/lead/${leadId}/groups/${encodeURIComponent(name)}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
      const res = await fetch(`/api/lead/${newGroupLeadId}/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newGroupName.trim(),
          memberIds: Array.from(newGroupMembers),
        }),
      });
      if (res.ok) {
        const group: ChatGroup = await res.json();
        useGroupStore.getState().addGroup(group);
        const tab = { leadId: group.leadId, name: group.name };
        setOpenTabs((prev) => [...prev, tab]);
        selectGroup(group.leadId, group.name);
        setShowCreate(false);
      }
    } catch { /* skip */ }
    finally { setCreating(false); }
  }, [newGroupName, newGroupLeadId, newGroupMembers, creating, selectGroup]);

  // All agents belonging to a selected lead (for the create dialog)
  const availableAgents = agents.filter((a) => a.parentId === newGroupLeadId || a.id === newGroupLeadId);

  /* ---- Selected group metadata ---- */
  const selectedGroupData = selectedGroup
    ? groups.find((g) => g.name === selectedGroup.name && g.leadId === selectedGroup.leadId)
    : null;

  const memberNames = selectedGroupData
    ? selectedGroupData.memberIds.map((id) => agentName(id)).join(', ')
    : '';

  /* ================================================================ */
  /*  Render                                                          */
  /* ================================================================ */

  return (
    <div className="flex flex-col h-full bg-[#1a1a2e] text-gray-200">
      {/* ---- Project tabs ---- */}
      {leads.length > 1 && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-gray-700/50 shrink-0 overflow-x-auto bg-gray-900/50">
          {leads.map((lead) => {
            const isActive = selectedProjectLeadId === lead.id;
            const projectGroups = groups.filter((g) => g.leadId === lead.id);
            return (
              <button
                key={lead.id}
                onClick={() => setSelectedProjectLeadId(lead.id)}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-md whitespace-nowrap transition-colors ${
                  isActive
                    ? 'bg-accent/20 text-accent font-medium'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'
                }`}
              >
                <Crown className="w-3 h-3" />
                <span className="truncate max-w-[120px]">{lead.projectName || lead.id.slice(0, 8)}</span>
                {projectGroups.length > 0 && (
                  <span className="text-[10px] text-gray-500 ml-0.5">({projectGroups.length})</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ---- Tab bar ---- */}
      <div className="flex items-center border-b border-gray-700 shrink-0 overflow-x-auto bg-[#1a1a2e]">
        {filteredTabs.length === 0 ? (
          <div className="flex items-center gap-2 px-4 h-10 text-gray-500 text-sm">
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
              const projectLabel = lead?.projectName || leadId.slice(0, 8);
              return (
                <div key={leadId} className="flex items-center shrink-0">
                  {showProjectHeaders && (
                    <span className="flex items-center gap-1 px-2 h-10 text-[10px] font-mono font-semibold text-purple-300/70 uppercase tracking-wider whitespace-nowrap border-r border-gray-700/40">
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
                            : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'
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
            className="flex items-center gap-1 px-2 h-10 text-xs text-gray-400 hover:text-accent hover:bg-gray-700/50 transition-colors shrink-0 border-b-2 border-transparent"
            title="Create group chat"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Re-open closed tabs dropdown */}
        {filteredGroups.length > filteredTabs.length && (
          <div className="relative ml-auto px-2">
            <select
              className="bg-gray-800 border border-gray-700 rounded text-xs text-gray-400 px-2 py-1 cursor-pointer"
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
                  const projectLabel = lead?.projectName || leadId.slice(0, 8);
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
            <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-700/50 shrink-0">
              <Users className="w-4 h-4 text-gray-500" />
              <div className="flex items-center gap-2 text-xs text-gray-500 truncate flex-wrap">
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
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {currentMessages.length === 0 && (
                <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                  No messages yet — start the conversation!
                </div>
              )}

              {currentMessages.map((msg) => {
                if (isSystem(msg)) {
                  return (
                    <div key={msg.id} className="flex justify-center">
                      <span className="text-xs text-gray-500 italic">
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
                        className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-xs shrink-0 mt-0.5"
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
                        <div className={`rounded-lg px-3 py-2 text-sm ${human ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-200'}`}>
                          <div className="whitespace-pre-wrap break-words prose-sm">
                            <MarkdownContent text={msg.content} mentionAgents={agents} onMentionClick={(id) => useAppStore.getState().setSelectedAgent(id)} />
                          </div>
                        </div>
                        <div className={`text-xs text-gray-500 mt-0.5 ${human ? 'text-right' : ''}`}>
                          {timeAgo(msg.timestamp)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              <div ref={messagesEndRef} />
            </div>

            {/* Compose bar */}
            <div className="border-t border-gray-700 p-3 shrink-0 relative">
              {/* Mention autocomplete dropdown */}
              {mentionSuggestions.length > 0 && (
                <div className="absolute bottom-full left-3 right-3 mb-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl max-h-40 overflow-y-auto z-10">
                  {mentionSuggestions.map((a, i) => (
                    <button
                      key={a.id}
                      onClick={() => insertMention(a)}
                      className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                        i === mentionIndex ? 'bg-accent/20 text-accent' : 'text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      <AgentIdBadge id={a.id} />
                      <span className="font-mono font-semibold">{a.role.name}</span>
                      <span className="text-gray-500 text-[10px] ml-auto">{a.status}</span>
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
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-accent"
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
          <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-3">
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
            className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md p-5 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Create Group Chat</h3>
              <button onClick={() => setShowCreate(false)} className="text-gray-500 hover:text-gray-300">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Group name */}
            <div>
              <label className="text-xs text-gray-400 block mb-1">Group name</label>
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="e.g. frontend-team"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
                autoFocus
              />
            </div>

            {/* Select lead/project */}
            {leads.length > 1 && (
              <div>
                <label className="text-xs text-gray-400 block mb-1">Project</label>
                <select
                  value={newGroupLeadId}
                  onChange={(e) => { setNewGroupLeadId(e.target.value); setNewGroupMembers(new Set()); }}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
                >
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.projectName ?? l.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Select members */}
            <div>
              <label className="text-xs text-gray-400 block mb-1">
                Members ({newGroupMembers.size} selected)
              </label>
              <div className="max-h-48 overflow-y-auto border border-gray-700 rounded-lg divide-y divide-gray-800">
                {availableAgents.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-gray-500 text-center">No agents in this project yet</div>
                ) : (
                  availableAgents.map((a) => (
                    <label
                      key={a.id}
                      className="flex items-center gap-3 px-3 py-2 hover:bg-gray-800 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={newGroupMembers.has(a.id)}
                        onChange={() => toggleMember(a.id)}
                        className="rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent"
                      />
                      <span className="text-sm">{a.role.icon} {a.role.name}</span>
                      <AgentIdBadge id={a.id} className="ml-auto" />
                    </label>
                  ))
                )}
              </div>
              <p className="text-[10px] text-gray-600 mt-1">You are always added automatically.</p>
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

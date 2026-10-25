import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { readUrlFilters, writeUrlFilters } from "./useTasksRoute";

interface TaskFilters {
    assignee?: string;
    label?: string;
    priority?: string;
    status?: string;
    search?: string;
}

export function useFilters({ activeTab }: { activeTab: string }) {
    const [searchParams, setSearchParams] = useSearchParams();
    const urlFilters = useMemo(() => readUrlFilters(searchParams), [searchParams]);
    const [filterAssignee, setFilterAssignee] = useState(urlFilters.assignee);
    const [filterLabel, setFilterLabel] = useState(urlFilters.label);
    const [filterPriority, setFilterPriority] = useState(urlFilters.priority);
    const [filterStatus, setFilterStatus] = useState(urlFilters.status);
    const [filterSearch, setFilterSearch] = useState(urlFilters.search);
    const [filtersOpen, setFiltersOpen] = useState(false);

    // Filters live in the query string so a view can be bookmarked and shared.
    // Writing on change keeps the URL and the controls in step; the replace
    // avoids filling history with every keystroke.
    useEffect(() => {
        setSearchParams(
            writeUrlFilters(searchParams, {
                assignee: filterAssignee,
                label: filterLabel,
                priority: filterPriority,
                status: filterStatus,
                search: filterSearch.trim(),
            }),
            { replace: true },
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filterAssignee, filterLabel, filterPriority, filterStatus, filterSearch]);

    const plannerFilters = useMemo<TaskFilters | undefined>(() => {
        const f: TaskFilters = {};
        if (filterAssignee) f.assignee = filterAssignee;
        if (filterLabel) f.label = filterLabel;
        if (filterPriority) f.priority = filterPriority;
        if (filterStatus) f.status = filterStatus;
        if (filterSearch.trim()) f.search = filterSearch.trim();
        return Object.keys(f).length ? f : undefined;
    }, [
        filterAssignee,
        filterLabel,
        filterPriority,
        filterStatus,
        filterSearch,
    ]);

    const backlogFilters = useMemo<TaskFilters | undefined>(() => {
        const f: TaskFilters = {};
        if (filterAssignee) f.assignee = filterAssignee;
        if (filterLabel) f.label = filterLabel;
        if (filterPriority) f.priority = filterPriority;
        if (filterSearch.trim()) f.search = filterSearch.trim();
        return Object.keys(f).length ? f : undefined;
    }, [filterAssignee, filterLabel, filterPriority, filterSearch]);

    const filterCount = useMemo(() => {
        const base = [
            filterAssignee,
            filterLabel,
            filterPriority,
            filterSearch.trim(),
        ];
        if (activeTab === "sprint" || activeTab === "scheduled") base.push(filterStatus);
        return base.filter(Boolean).length;
    }, [
        filterAssignee,
        filterLabel,
        filterPriority,
        filterStatus,
        filterSearch,
        activeTab,
    ]);

    const clearFilters = () => {
        setFilterAssignee("");
        setFilterLabel("");
        setFilterPriority("");
        setFilterStatus("");
        setFilterSearch("");
    };

    return {
        filterAssignee,
        setFilterAssignee,
        filterLabel,
        setFilterLabel,
        filterPriority,
        setFilterPriority,
        filterStatus,
        setFilterStatus,
        filterSearch,
        setFilterSearch,
        filtersOpen,
        setFiltersOpen,
        plannerFilters,
        backlogFilters,
        filterCount,
        clearFilters,
    };
}
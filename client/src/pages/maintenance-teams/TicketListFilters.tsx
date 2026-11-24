import { MAINTENANCE_RESPONSIBLE_DEPARTMENT } from "@shared/roles";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ticketListText } from "@/i18n/ticketList";
import {
  ticketListStatuses,
  type TicketListState,
  type TicketListStatus,
} from "./ticket-list-state";

type ListOption = { id: number; name: string };
export type TicketListOptions = {
  teams: ListOption[];
  executors?: ListOption[];
  sites: ListOption[];
  sections: Array<ListOption & { siteId: number }>;
};
export function TicketListFilters({
  value,
  searchInput,
  onSearchInput,
  onChange,
  onReset,
  options,
  language,
}: {
  value: TicketListState;
  searchInput: string;
  onSearchInput: (value: string) => void;
  onChange: (changes: Partial<TicketListState>) => void;
  onReset: () => void;
  options: TicketListOptions;
  language: "ar" | "en" | "ur";
}) {
  const text = ticketListText[language];
  const it = value.department === MAINTENANCE_RESPONSIBLE_DEPARTMENT.IT;
  const selectClass =
    "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const sections = options.sections.filter(
    section => value.siteId == null || section.siteId === value.siteId
  );
  return (
    <form
      role="search"
      className="space-y-4 rounded-xl border bg-card p-4"
      onSubmit={event => {
        event.preventDefault();
        onChange({ search: searchInput });
      }}
    >
      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="ticket-list-search">
          {text.search}
        </label>
        <Input
          id="ticket-list-search"
          dir={language === "en" ? "ltr" : "rtl"}
          className="text-start"
          type="search"
          maxLength={200}
          value={searchInput}
          placeholder={it ? text.searchPlaceholderIt : text.searchPlaceholder}
          onChange={event => onSearchInput(event.currentTarget.value)}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="space-y-1.5">
          <label htmlFor="ticket-list-status" className="text-sm font-medium">
            {text.status}
          </label>
          <select
            id="ticket-list-status"
            className={selectClass}
            value={value.status}
            onChange={event =>
              onChange({
                status: event.currentTarget.value as TicketListStatus,
              })
            }
          >
            {value.status === "action_required" && (
              <option value="action_required">
                {text.statuses.action_required}
              </option>
            )}
            {ticketListStatuses.map(status => (
              <option key={status} value={status}>
                {text.statuses[status]}
              </option>
            ))}
          </select>
        </div>
        {it ? (
          <div className="space-y-1.5">
            <label
              htmlFor="ticket-list-executor"
              className="text-sm font-medium"
            >
              {text.executor}
            </label>
            <select
              id="ticket-list-executor"
              className={selectClass}
              value={value.executorId ?? "all"}
              onChange={event =>
                onChange({
                  executorId:
                    event.currentTarget.value === "all"
                      ? undefined
                      : Number(event.currentTarget.value),
                })
              }
            >
              <option value="all">{text.allExecutors}</option>
              {(options.executors || []).map(executor => (
                <option key={executor.id} value={executor.id}>
                  {executor.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="space-y-1.5">
            <label htmlFor="ticket-list-team" className="text-sm font-medium">
              {text.team}
            </label>
            <select
              id="ticket-list-team"
              className={selectClass}
              value={value.teamId ?? "all"}
              onChange={event =>
                onChange({
                  teamId:
                    event.currentTarget.value === "all"
                      ? undefined
                      : Number(event.currentTarget.value),
                })
              }
            >
              <option value="all">{text.allTeams}</option>
              {options.teams.map(team => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="space-y-1.5">
          <label htmlFor="ticket-list-site" className="text-sm font-medium">
            {text.site}
          </label>
          <select
            id="ticket-list-site"
            className={selectClass}
            value={value.siteId ?? "all"}
            onChange={event =>
              onChange({
                siteId:
                  event.currentTarget.value === "all"
                    ? undefined
                    : Number(event.currentTarget.value),
              })
            }
          >
            <option value="all">{text.allSites}</option>
            {options.sites.map(site => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ticket-list-section" className="text-sm font-medium">
            {text.section}
          </label>
          <select
            id="ticket-list-section"
            className={selectClass}
            value={value.sectionId ?? "all"}
            onChange={event =>
              onChange({
                sectionId:
                  event.currentTarget.value === "all"
                    ? undefined
                    : Number(event.currentTarget.value),
              })
            }
          >
            <option value="all">{text.allSections}</option>
            {sections.map(section => (
              <option key={section.id} value={section.id}>
                {section.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ticket-list-sort" className="text-sm font-medium">
            {text.sort}
          </label>
          <select
            id="ticket-list-sort"
            className={selectClass}
            value={value.sort}
            onChange={event =>
              onChange({
                sort:
                  event.currentTarget.value === "newest" ? "newest" : "oldest",
              })
            }
          >
            <option value="oldest">{text.oldest}</option>
            <option value="newest">{text.newest}</option>
          </select>
        </div>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onReset}>
        {text.reset}
      </Button>
    </form>
  );
}

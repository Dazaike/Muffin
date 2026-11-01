import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { SearchField } from "@/components/lists/SearchField";
import { EmptyState } from "@/components/ui/StateSwitch";
import type { SocialUser } from "@/lib/socialTypes";
import { PeopleList } from "./PeopleList";
import { usePeople, type FriendActions } from "./useFriends";

/** Must match `MIN_SEARCH_CHARS` in `social.rs` (Roblox rejects shorter keywords). */
const MIN_CHARS = 3;
const DEBOUNCE_MS = 400;

export function FindTab({
  userId,
  actions,
  onUnfriend,
}: {
  userId: number;
  actions: FriendActions;
  onUnfriend: (user: SocialUser) => void;
}) {
  const [text, setText] = useState("");
  const [keyword, setKeyword] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setKeyword(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);

  const ready = keyword.length >= MIN_CHARS;
  const query = usePeople(userId, "search", keyword, ready);

  return (
    <div className="flex flex-col gap-4">
      <SearchField value={text} onChange={setText} placeholder="Search Roblox users by name" className="max-w-md" autoFocus />
      {ready ? (
        <PeopleList
          query={query}
          context="search"
          actions={actions}
          onUnfriend={onUnfriend}
          empty={<EmptyState title={`No users found for “${keyword}”`} hint="Roblox search matches usernames and display names." />}
        />
      ) : (
        <EmptyState
          icon={<Search size={22} strokeWidth={1.75} />}
          title="Find people on Roblox"
          hint={`Type at least ${MIN_CHARS} characters of a username or display name.`}
        />
      )}
    </div>
  );
}

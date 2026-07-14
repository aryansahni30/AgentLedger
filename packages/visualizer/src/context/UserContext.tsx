import { createContext, useContext, useEffect, useState } from "react";

interface UserContextValue {
  currentUser: string;
}

const UserContext = createContext<UserContextValue>({ currentUser: "unknown" });

export function UserProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [currentUser, setCurrentUser] = useState("unknown");

  useEffect(() => {
    fetch("/api/whoami")
      .then((r) => r.json())
      .then((body: { success: boolean; data: { user: string } }) => {
        if (body.success) setCurrentUser(body.data.user);
      })
      .catch(() => {
        // stay "unknown" on network failure
      });
  }, []);

  return <UserContext.Provider value={{ currentUser }}>{children}</UserContext.Provider>;
}

export function useCurrentUser(): string {
  return useContext(UserContext).currentUser;
}

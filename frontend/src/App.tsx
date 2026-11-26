import { Route, Routes, useParams } from 'react-router'

import { Sidebar } from './components/Sidebar.tsx'
import { ChatPage } from './pages/ChatPage.tsx'

/**
 * Re-mount the chat page whenever the URL's chat id changes, so no state
 * (pending messages, a half-typed system prompt) leaks from one chat into another.
 */
function ConversationRoute() {
  const { conversationId } = useParams()
  return <ChatPage key={conversationId} />
}

export default function App() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <Routes>
        <Route path="/" element={<ChatPage key="new" />} />
        <Route path="/c/:conversationId" element={<ConversationRoute />} />
        <Route path="*" element={<ChatPage key="new" />} />
      </Routes>
    </div>
  )
}

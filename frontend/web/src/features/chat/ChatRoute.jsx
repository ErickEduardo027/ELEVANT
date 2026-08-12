import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ChatPage from './ChatPage';
import { useChatData } from './useChatData';
import { useAdminOccPreview } from '../admin-occ/AdminOccPreviewContext';

// La navegación cruzada hacia Monitoreo de Vuelos / Revisión sigue el mismo
// patrón de query param que FlightMonitoringRoute/ReviewRoute/NotificationsRoute
// (`?flightId=`/`?operationId=`); ChatHeader dispara 'flight-monitoring' desde
// "Ver vuelo" y 'approvals' desde "Ver operación" (ver ChatPage.jsx).
export default function ChatRoute() {
  const [retryToken, setRetryToken] = useState(0);
  const { forceState } = useAdminOccPreview();
  const chat = useChatData('PUJ', retryToken, forceState === 'chatDisconnected');
  const navigate = useNavigate();

  return (
    <ChatPage
      status={chat.status}
      data={chat.data}
      error={chat.error}
      connection={chat.connection}
      onRetry={() => setRetryToken(token => token + 1)}
      onSendMessage={chat.sendMessage}
      onMarkAsRead={chat.markAsRead}
      onCloseConversation={chat.closeConversation}
      onCreateConversation={chat.createConversation}
      onNavigateToResource={(moduleId, resourceId) => {
        if (moduleId === 'flight-monitoring') navigate(`/admin-occ/flight-monitoring?flightId=${resourceId}`);
        if (moduleId === 'approvals') navigate(`/admin-occ/review?operationId=${resourceId}`);
      }}
      forceState={forceState}
    />
  );
}

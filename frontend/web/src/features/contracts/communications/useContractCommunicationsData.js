import { useEffect, useMemo, useState } from 'react';
import { getContractConversations, markContractConversationRead, sendContractMessage } from '../../../services/contractCommunicationsService';

export function useContractCommunicationsData() {
  const [state, setState] = useState({ status: 'loading', data: [], error: null });
  const [query, setQuery] = useState('');

  function load() {
    setState(current => ({ ...current, status: 'loading', error: null }));
    return getContractConversations()
      .then(data => setState({ status: 'success', data, error: null }))
      .catch(error => setState({ status: 'error', data: [], error }));
  }

  useEffect(() => { load(); }, []);

  const conversations = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('es');
    return state.data.filter(conversation => !normalized || conversation.participant.toLocaleLowerCase('es').includes(normalized) || conversation.contextLabel.toLocaleLowerCase('es').includes(normalized));
  }, [query, state.data]);

  function replace(updated) {
    setState(current => ({ ...current, data: current.data.map(conversation => conversation.id === updated.id ? updated : conversation) }));
  }

  async function markRead(id) {
    const updated = await markContractConversationRead(id);
    replace(updated);
  }

  async function sendMessage(id, text) {
    const updated = await sendContractMessage(id, text);
    replace(updated);
  }

  return { ...state, conversations, query, setQuery, retry: load, markRead, sendMessage };
}

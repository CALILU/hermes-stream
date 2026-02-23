import { useState, useCallback } from 'react';
import { API_BASE } from '../constants';
import { authFetch } from '../utils/api';

export function useUsers() {
  const [userManagementModal, setUserManagementModal] = useState(false);
  const [users, setUsers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [activeTab, setActiveTab] = useState('users');

  // Create user form
  const [createUserForm, setCreateUserForm] = useState({ username: '', password: '', role: 'viewer', displayName: '' });
  const [creatingUser, setCreatingUser] = useState(false);
  const [createUserError, setCreateUserError] = useState('');

  // Invitation form
  const [invitationForm, setInvitationForm] = useState({ expiresInDays: 7, role: 'viewer' });
  const [creatingInvitation, setCreatingInvitation] = useState(false);
  const [lastCreatedInvitation, setLastCreatedInvitation] = useState(null);

  const loadUsers = useCallback(async () => {
    try {
      const res = await authFetch(`${API_BASE}/api/auth/users`);
      const data = await res.json();
      if (data.success) setUsers(data.data);
    } catch (err) {
      console.error('Error cargando usuarios:', err);
    }
  }, []);

  const loadInvitations = useCallback(async () => {
    try {
      const res = await authFetch(`${API_BASE}/api/auth/invitations`);
      const data = await res.json();
      if (data.success) setInvitations(data.data);
    } catch (err) {
      console.error('Error cargando invitaciones:', err);
    }
  }, []);

  const createUser = async () => {
    if (!createUserForm.username || !createUserForm.password) return;
    setCreatingUser(true);
    setCreateUserError('');
    try {
      const res = await authFetch(`${API_BASE}/api/auth/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createUserForm)
      });
      const data = await res.json();
      if (data.success) {
        setCreateUserForm({ username: '', password: '', role: 'viewer', displayName: '' });
        loadUsers();
      } else {
        setCreateUserError(data.error || 'Error al crear usuario');
      }
    } catch (err) {
      setCreateUserError('Error de conexion');
    } finally {
      setCreatingUser(false);
    }
  };

  const deleteUser = async (id) => {
    try {
      const res = await authFetch(`${API_BASE}/api/auth/users/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) loadUsers();
      else alert(data.error || 'Error al eliminar usuario');
    } catch (err) {
      console.error('Error eliminando usuario:', err);
    }
  };

  const createInvitation = async () => {
    setCreatingInvitation(true);
    try {
      const res = await authFetch(`${API_BASE}/api/auth/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invitationForm)
      });
      const data = await res.json();
      if (data.success) {
        setLastCreatedInvitation(data.data);
        loadInvitations();
      }
    } catch (err) {
      console.error('Error creando invitacion:', err);
    } finally {
      setCreatingInvitation(false);
    }
  };

  const deleteInvitation = async (id) => {
    try {
      const res = await authFetch(`${API_BASE}/api/auth/invitations/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) loadInvitations();
    } catch (err) {
      console.error('Error eliminando invitacion:', err);
    }
  };

  const openUserManagement = () => {
    setUserManagementModal(true);
    setLoadingUsers(true);
    Promise.all([loadUsers(), loadInvitations()]).finally(() => setLoadingUsers(false));
  };

  const closeUserManagement = () => {
    setUserManagementModal(false);
    setLastCreatedInvitation(null);
    setCreateUserError('');
  };

  return {
    userManagementModal, users, invitations, loadingUsers, activeTab,
    createUserForm, creatingUser, createUserError,
    invitationForm, creatingInvitation, lastCreatedInvitation,
    setActiveTab, setCreateUserForm, setInvitationForm, setLastCreatedInvitation,
    createUser, deleteUser, createInvitation, deleteInvitation,
    openUserManagement, closeUserManagement
  };
}

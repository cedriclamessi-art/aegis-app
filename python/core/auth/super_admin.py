# core/auth/super_admin.py

SUPER_ADMIN_EMAILS = {
    'jonathanlamessi@yahoo.fr',
    'Enna.lamessi@gmail.com'
}

class SuperAdminMiddleware:
    """
    Protection critique des comptes fondateurs
    """
    
    def enforce_constraints(self, user: User):
        # 1. Emails super admin immuables
        if user.email in SUPER_ADMIN_EMAILS:
            user.is_super_admin = True
            user.is_lifetime_free = True
            user.agents_quota = 9999
            user.empire_index_max = 100
            
        # 2. Impossible de supprimer un super admin
        if user.email in SUPER_ADMIN_EMAILS:
            raise PermissionError("Cannot delete founder account")
            
        # 3. Audit immuable
        self.log_action(user, action, immutable=True)
        
    def require_2fa_for_sensitive(self, user: User, action: str):
        if user.email in SUPER_ADMIN_EMAILS and action in CRITICAL_ACTIONS:
            if not user.two_factor_enabled:
                raise SecurityError("2FA required for founders")
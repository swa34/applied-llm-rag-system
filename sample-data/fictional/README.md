# Fictional demonstration corpus

Every document in this directory is original, invented material for a local retrieval-augmented generation demonstration. Northbridge Learning Institute is a fictional organization. No document represents an employer's policies, confidential information, or a real service's instructions.

The corpus contains four policy and help documents:

- `travel.md`: supervisor approval for overnight trips, a separate section covering part-time eligibility, and covered expense categories.
- `tuition.md`: full-time eligibility after six months and a separate section excluding part-time staff.
- `purchasing.md`: department head approval for purchase requests.
- `password-reset.md`: fictional self-service reset steps and help instructions.

Travel pet-sitting reimbursement is intentionally absent from the policy documents. A question about it tests whether the assistant reports missing evidence instead of inventing an approval, denial, or reimbursement rule. This README documents that evaluation setup and must be excluded from the retrieval index.

The paired follow-up "Does that change for part-time staff?" should lead to fresh travel or tuition evidence according to the conversation. A comparison of travel and purchasing followed by "Who signs off on that?" should require clarification. A password reset question after a travel discussion should retrieve the reset guide as a new topic.

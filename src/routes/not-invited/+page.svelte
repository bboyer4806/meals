<script lang="ts">
	import { page } from '$app/state';

	const email = $derived(page.url.searchParams.get('email') ?? 'This account');
</script>

<main class="page">
	<h1>Meals is invite-only</h1>
	<p><strong>{email}</strong> hasn't been invited.</p>
	<p>
		Ask someone in your household to invite this address, or sign in with the Google account you
		were invited with.
	</p>
	<a class="button primary" href="/login/google" data-sveltekit-reload>Use another account</a>
</main>

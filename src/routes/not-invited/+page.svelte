<script lang="ts">
	let { data } = $props();
</script>

<main class="page">
	<h1>Meals is invite-only</h1>
	<p><strong>{data.email ?? 'This account'}</strong> hasn't been invited.</p>
	<p>
		Ask someone in your household to invite this address, or sign in with the Google account you
		were invited with.
	</p>
	<a class="button primary" href="/login/google" data-sveltekit-reload>Use another account</a>
</main>

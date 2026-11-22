<script lang="ts">
	import { page } from '$app/state';
</script>

<main class="page">
	<h1>{page.status === 404 ? 'Not found' : 'Something went wrong'}</h1>
	<p>{page.error?.message}</p>
	<!-- Only an unexpected error has one, the id the server's log has for it (4.5). -->
	{#if page.error?.id}
		<p>Error ID: {page.error.id}</p>
	{/if}
	<p><a class="link-tap" href="/">Back to Meals</a></p>
</main>

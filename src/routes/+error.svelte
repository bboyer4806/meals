<script lang="ts">
	import { page } from '$app/state';
</script>

<main class="page">
	<h1>{page.status === 404 ? 'Not found' : 'Something went wrong'}</h1>
	<p>{page.error?.message}</p>
	<p><a class="link-tap" href="/">Back to Meals</a></p>
</main>
